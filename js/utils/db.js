// Optimistic concurrency: the update only applies if `version` is still what the user loaded.
export async function updateVersioned(sb, table, id, version, patch, idCol = 'id') {
  const { data, error } = await sb.from(table).update(patch)
    .eq(idCol, id).eq('version', version).select().maybeSingle();
  if (error) throw error;
  if (!data) {
    throw Object.assign(new Error('This record was changed by someone else. Reload and try again.'), { code: 'CONFLICT' });
  }
  return data;
}
