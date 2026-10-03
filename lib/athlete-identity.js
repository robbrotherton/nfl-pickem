function athleteId(athlete = {}) {
    return String(athlete.id || athlete.$ref?.match(/\/athletes\/(\d+)/)?.[1] ||
        athlete.links?.map(link => link.href?.match(/\/id\/(\d+)/)?.[1]).find(Boolean) || '');
}

module.exports = { athleteId };
