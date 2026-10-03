// Shared, persistent upstream caching. Selection and presentation rules live elsewhere.
function createEspnCache({ store, now, fetchJson }) {
    const pending = new Map();
    async function get(url, ttl, { version = '', validate = () => {} } = {}) {
        let entry = store.read(url);
        if (entry?.data) {
            try { validate(entry.data); } catch { entry = { ...entry, data: null }; }
        }
        const result = (data, fetchedAt, stale = false) => ({ data, fetchedAt, stale });
        if (entry?.data && entry.version === version && now() - entry.fetched_at < ttl) {
            return result(entry.data, entry.fetched_at);
        }
        if (entry && entry.retry_after > now()) {
            if (!entry.data) throw new Error('Retry deferred');
            return result(entry.data, entry.fetched_at, true);
        }
        if (pending.has(url)) return pending.get(url);
        const promise = (async () => {
            try {
                const data = await fetchJson(url);
                validate(data);
                const fetchedAt = now();
                store.write(url, data, fetchedAt, version);
                return result(data, fetchedAt);
            } catch (error) {
                store.failed(url);
                if (entry?.data) return result(entry.data, entry.fetched_at, true);
                throw error;
            }
        })();
        pending.set(url, promise);
        try { return await promise; } finally { pending.delete(url); }
    }
    return { get };
}

module.exports = { createEspnCache };
