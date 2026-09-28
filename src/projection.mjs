// Public MCP projections. The manager keeps the complete durable record; this
// module controls what crosses the MCP boundary.
import {contextLimitTokens} from './config.mjs';
const HIDDEN = new Set();

export function sanitize(value, {full = false} = {}) {
  if (Array.isArray(value)) return value.map(v => sanitize(v, {full}));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (HIDDEN.has(key.toLowerCase())) continue;
    out[key] = sanitize(item, {full});
  }
  return out;
}

// Machine-only identifiers. A reader scanning the head of a truncated tool
// result wants size, state and text first; cursors and IDs still travel, at the
// end, where the agent reads them.
const TAIL = new Set(['agent_id', 'id', 'session_id', 'workspace_id', 'request_id', 'event_id', 'seq', 'next_cursor', 'continuation_cursor', 'call_id', 'callId']);

function tailIds(value) {
  if (Array.isArray(value)) return value.map(tailIds);
  if (!value || typeof value !== 'object') return value;
  const head = {}, tail = {};
  for (const [key, item] of Object.entries(value)) (TAIL.has(key) ? tail : head)[key] = tailIds(item);
  return {...head, ...tail};
}

// Every tool result is presented with its own size first, so the cost of a
// response is visible before its body is read. The count includes the field
// itself, so it settles once its digits stop changing.
export function present(value) {
  const body = tailIds(Array.isArray(value) ? {count: value.length, items: value} : value);
  const measure = len => JSON.stringify({len: `${len} chars`, ...body}).length;
  let len = 0, next = measure(0);
  while (next !== len) { len = next; next = measure(len); }
  return {len: `${len} chars`, ...body};
}

export function receipt(value, operation) {
  const id = value.id ?? value.agent_id;
  const out={agent_id: id, id, operation, status: value.status, accepted: true};
  if(value.name) out.name=value.name;
  Object.assign(out, context(value));
  if(value.delivery) out.delivery=sanitize(value.delivery);
  if(value.request_id) out.request_id=value.request_id;
  return out;
}

function context(value) {
  const limit = contextLimitTokens(value.provider);
  if (!value.context_tokens) return {};
  return limit ? {context_tokens: value.context_tokens, context_limit_tokens: limit} : {context_tokens: value.context_tokens};
}

export function status(value, {full = false} = {}) {
  if (full) return sanitize({...value, agent_id: value.id}, {full: true});
  const out = {agent_id: value.id, id: value.id, status: value.status};
  for (const key of ['name', 'cwd', 'finish_reason', 'last_event', 'updated_at', 'workspace_id', 'error']) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== '') out[key] = sanitize(value[key]);
  }
  Object.assign(out, context(value));
  if (value.status === 'running' && value.last_event) out.progress = value.last_event;
  return out;
}

const clip = (text, limit = 200) => text.length > limit ? `${text.slice(0, limit)}…(+${text.length - limit})` : text;
const ACTIVE = ['starting', 'running', 'interrupting'];

function reason(value) {
  const kind = value.finish_reason?.kind;
  // A completed turn is already reported by status; only a failure adds anything.
  if (!kind || kind === 'completed') return undefined;
  const detail = value.finish_reason.error?.message ?? value.finish_reason.reason?.kind;
  return detail ? `${kind}: ${clip(String(detail), 120)}` : kind;
}

// One row of a listing carries what picks an agent out of a hundred: state,
// name, workspace, recency. The rest of the record is one dsh_status away, so
// the identifier appears once, under the name later calls pass back.
function entry(value) {
  const out = {status: value.status};
  for (const key of ['name', 'cwd']) if (value[key]) out[key] = value[key];
  const failed = reason(value);
  if (failed) out.finish_reason = failed;
  if (value.error) out.error = clip(String(value.error));
  if (value.status === 'running' && value.last_event) out.progress = value.last_event;
  if (value.context_tokens) out.context_tokens = value.context_tokens;
  if (value.updated_at) out.updated_at = value.updated_at;
  out.agent_id = value.id;
  return out;
}

// Listings are newest first and bounded: a full history costs tens of
// thousands of characters, nearly all of it agents nobody is looking for.
// Filters narrow before the cap, so a hunted agent stays reachable.
export function list(values, {full = false, limit = 20, maxChars = 12000, state, cwd, match} = {}) {
  let rows = values;
  if (state) rows = rows.filter(value => value.status === state);
  if (cwd) {
    const root = cwd.replace(/\/+$/, '');
    rows = rows.filter(value => value.cwd === root || String(value.cwd).startsWith(root + '/'));
  }
  if (match) {
    const needle = match.toLowerCase();
    rows = rows.filter(value => `${value.name ?? ''} ${value.cwd ?? ''}`.toLowerCase().includes(needle) || String(value.id).startsWith(match));
  }
  // legacy keeps the complete per-agent record, under the same bounds: the
  // whole history of it runs past a million characters. Rows stop at the row
  // cap or the character budget, whichever comes first.
  // Order on the timestamp rather than inherit the manager's row order, which
  // is only recency-ordered because save() reassigns the rowid. An agent in a
  // long silent tool call stops being re-saved either way, so active agents go
  // first: recency alone would push the one running agent below a page of
  // finished ones.
  rows = [...rows].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
  rows = [...rows.filter(value => ACTIVE.includes(value.status)), ...rows.filter(value => !ACTIVE.includes(value.status))];
  // matched separates "your filter found nothing" from "the store is empty":
  // total always counts every stored agent.
  const filtered = rows.length !== values.length || Boolean(state || cwd || match);
  const shape = (shown, dropped, bound) => {
    const out = {count: shown.length};
    if (filtered) out.matched = rows.length;
    out.total = values.length;
    if (dropped > 0) out.omitted = `${dropped} more rows not shown (${bound}); raise limit or max_chars, or narrow with status/cwd/match`;
    out.items = shown;
    return out;
  };
  const items = [];
  let bound = 'row limit';
  for (const value of rows) {
    if (items.length >= limit) break;
    const item = full ? status(value, {full: true}) : entry(value);
    // The budget covers the whole projection, the way publicEvents measures its own.
    if (items.length && JSON.stringify(shape([...items, item], rows.length - items.length - 1, 'size budget')).length > maxChars) { bound = 'size budget'; break; }
    items.push(item);
  }
  return shape(items, rows.length - items.length, bound);
}

export function wait(value, {full = false} = {}) {
  if (full) return sanitize({...value, agent_id: value.id}, {full: true});
  const out = status(value);
  for (const key of ['wait_outcome', 'next_action']) if (value[key] !== undefined) out[key] = value[key];
  // Only a settled wait gets the final answer; repeated waits return it again.
  // Partial streaming text is deliberately never part of this projection.
  if (value.wait_outcome === 'settled' && value.status === 'completed' && value.answer) out.answer = value.answer;
  // The failed turn produced nothing to accept; hand over the last good result.
  if (value.wait_outcome === 'settled' && value.status === 'context_exhausted' && value.last_completed_answer) out.last_completed_answer = value.last_completed_answer;
  return out;
}

function assistantText(data) {
  if (typeof data?.text === 'string') return data.text;
  if (typeof data?.event?.text === 'string') return data.event.text;
  const message = data?.message ?? data?.event?.data?.message;
  return (message?.content ?? []).filter(block => block?.type === 'text').map(block => block.text ?? '').join('\n');
}

function toolType(type) { return /(^|\/)(tool|permission|approval|sandbox)(\/|$)/.test(type); }

export function eventProjection(row, {includeProgress = false, includeDescendants = false, includeToolEvents = false, fullEventId = undefined} = {}) {
  const type = row.type;
  const dataObj = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  const descendant = type.startsWith('descendant/');
  if (descendant && !includeDescendants) return null;
  const nestedType = dataObj?.event?.type;
  // The manager resolves this candidate within the completed root turn. Use
  // the end event's cursor so reading progress never consumes a future answer.
  if (type === 'turn/end' && dataObj?.reason?.kind === 'completed' && row.finalText)
    return {event_id: row.seq, seq: row.seq, type: 'assistant/final', text: row.finalText};
  const text = assistantText(dataObj);
  if (type === 'assistant/message' || type.endsWith('/assistant/message') || nestedType === 'assistant/message')
    return includeProgress ? {event_id: row.seq, seq: row.seq, type: 'assistant/message', text, scope: descendant ? 'descendant' : 'root'} : null;
  const effectiveType=nestedType ?? type;
  if (!includeToolEvents || !toolType(effectiveType)) return null;
  const full = fullEventId === row.seq;
  if (full) return {event_id: row.seq, seq: row.seq, type:effectiveType, data: sanitize(dataObj, {full: true})};
  const data = dataObj?.event?.data && typeof dataObj.event.data === 'object' ? dataObj.event.data : (dataObj && typeof dataObj === 'object' ? dataObj : {});
  const summary = {};
  for (const key of ['name', 'tool', 'command', 'status', 'path', 'exit_code', 'exitCode', 'call_id', 'callId', 'id']) {
    if (data[key] !== undefined && (typeof data[key] !== 'object' || data[key] === null)) summary[key] = typeof data[key] === 'string' ? data[key].slice(0, 240) : data[key];
  }
  return {event_id: row.seq, seq: row.seq, type:effectiveType, summary};
}

export function events(rows, {includeProgress = false, includeDescendants = false, includeToolEvents = false, eventId, maxChars = 12000} = {}) {
  const selected = [];
  let used = 0;
  for (const row of rows) {
    const item = eventProjection(row, {includeProgress, includeDescendants, includeToolEvents, fullEventId: eventId});
    if (!item) continue;
    const size = JSON.stringify(item).length;
    if (selected.length && used + size > maxChars) break;
    if (!selected.length && size > maxChars) { selected.push(item); used += size; break; }
    selected.push(item); used += size;
  }
  return selected;
}
