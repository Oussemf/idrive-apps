'use strict';

const $ = id => document.getElementById(id);
let current = { allowed: false }, requestId = 0;
const bridge = window.idrive;

function error(message) { $('error').textContent = message; $('error').hidden = !message; }
async function call(method, value) {
    if (!bridge) throw new Error('Runtime Electron requis. Lancez npm start, pas ce fichier seul.');
    const result = await bridge[method](value);
    if (!result.ok) throw new Error(result.error);
    return result.data;
}
function stop() {
    $('player').removeAttribute('src');
    $('playback').hidden = true; $('browse').hidden = false;
    document.body.classList.remove('playing');
}
function update(state) {
    current = state;
    $('status').textContent = state.status;
    $('confirmation').hidden = state.mgu;
    $('fullscreen').textContent = state.fullscreen ? 'Quitter le plein ecran' : 'Plein ecran';
    $('player-fullscreen').textContent = $('fullscreen').textContent;
    $('api-note').textContent = state.hasApiKey ? 'YouTube Data API v3 - 12 resultats par recherche.' :
        'Cle API non configuree : ouvrez un lien video ou utilisez YouTube TV.';
    for (const id of ['query', 'link', 'tv', 'fullscreen', 'player-fullscreen']) $(id).disabled = !state.allowed;
    document.querySelectorAll('button[type="submit"], .result').forEach(button => { button.disabled = !state.allowed; });
    if (!state.allowed) { requestId++; stop(); }
}
async function play(input) {
    const id = await call('play', input);
    if (!current.allowed) return;
    const url = new URL('https://www.youtube-nocookie.com/embed/' + id);
    url.searchParams.set('origin', location.origin);
    url.searchParams.set('playsinline', '1');
    url.searchParams.set('autoplay', '0');
    $('player').src = url.href;
    $('browse').hidden = true; $('playback').hidden = false;
    document.body.classList.add('playing');
}
function action(fn) {
    return async event => {
        event.preventDefault(); error('');
        try { await fn(event); } catch (failure) { stop(); error(failure.message); }
    };
}
$('search-form').addEventListener('submit', action(async () => {
    const id = ++requestId;
    $('empty').textContent = 'Recherche en cours...';
    $('results').replaceChildren(); $('empty').hidden = false;
    try {
        const items = await call('search', $('query').value);
        if (id !== requestId || !current.allowed) return;
        for (const item of items) {
            const button = document.createElement('button');
            button.className = 'result';
            const title = document.createElement('span'); title.textContent = item.title;
            const channel = document.createElement('small'); channel.textContent = item.channel;
            button.append(title, channel);
            button.addEventListener('click', action(() => play(item.id)));
            $('results').append(button);
        }
        $('empty').hidden = items.length > 0;
        $('empty').textContent = 'Aucun resultat. Essayez une autre recherche.';
    } catch (failure) {
        $('empty').textContent = 'Recherche interrompue.';
        throw failure;
    }
}));
$('link-form').addEventListener('submit', action(() => play($('link').value)));
$('back').addEventListener('click', stop);
$('native').addEventListener('click', stop);
$('tv').addEventListener('click', action(() => call('tv')));
$('fullscreen').addEventListener('click', action(async () => {
    await call('fullscreen'); update(await call('state'));
}));
$('player-fullscreen').addEventListener('click', action(async () => {
    await call('fullscreen'); update(await call('state'));
}));
$('parked').addEventListener('change', action(async () => update(await call('confirmParked', $('parked').checked))));
document.addEventListener('keydown', event => {
    if (!['F11', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape' && !current.fullscreen) { stop(); return; }
    call('fullscreen').catch(failure => error(failure.message));
});
if (bridge) {
    bridge.onState(update);
    call('state').then(update).catch(failure => error(failure.message));
} else error('Runtime Electron requis. Utilisez npm start.');
