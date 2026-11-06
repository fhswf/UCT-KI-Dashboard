export function isValidSensorId(id) {
    return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

export function isValidEndParam(end) {
    if (end === undefined) return true;
    const t = new Date(end).getTime();
    if (isNaN(t)) return false;
    const now = Date.now();
    // Accept dates within the last 5 years and up to 24 hours in the future
    return (
        t >= now - 5 * 365 * 24 * 60 * 60 * 1000 &&
        t <= now + 24 * 60 * 60 * 1000
    );
}
