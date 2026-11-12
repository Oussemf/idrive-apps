'use strict';

const MAX_AGE_MS = 2500;
const MAX_SPEED_AGE_MS = 5000;

function permit(snapshot, now, allowGarageTest) {
    now = now === undefined ? Date.now() : now;
    if (!snapshot || snapshot.foreground !== true) return false;
    if (!Number.isFinite(snapshot.updated) || snapshot.updated > now ||
        now - snapshot.updated > MAX_AGE_MS) return false;
    if (allowGarageTest === true && snapshot.garageTest === true) return true;
    if (!Number.isFinite(snapshot.speedUpdated) || snapshot.speedUpdated > now ||
        now - snapshot.speedUpdated > MAX_SPEED_AGE_MS) return false;
    return snapshot.speedKmh === 0;
}

function decodeSpeed(value) {
    const raw = value && value.speedVehicleCentreOfGravity;
    return Number.isInteger(raw) && raw >= 0 && raw < 65535 ? raw / 64 : null;
}

module.exports = { permit, decodeSpeed, MAX_AGE_MS, MAX_SPEED_AGE_MS };
