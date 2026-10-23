// Optimistic concurrency: the update only applies if `version` is still what the user loaded.
export async function updateVersionedBy(sb, table, match, version, patch) {
  let q = sb.from(table).update(patch);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data, error } = await q.eq('version', version).select().maybeSingle();
  if (error) throw error;
  if (!data) {
    throw Object.assign(new Error('This record was changed by someone else (or you no longer have permission). Reload and try again.'), { code: 'CONFLICT' });
  }
  return data;
}

export const updateVersioned = (sb, table, id, version, patch, idCol = 'id') =>
  updateVersionedBy(sb, table, { [idCol]: id }, version, patch);

// Fetch every row past the API's 1000-row page cap. buildQuery must return a NEW ordered query each call.
export async function fetchAll(buildQuery, page = 1000) {
  let out = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await buildQuery().range(from, from + page - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < page) break;
  }
  return out;
}
