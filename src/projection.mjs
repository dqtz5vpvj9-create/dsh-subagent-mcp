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

export function list(values, {full = false} = {}) {
  return values.map(value => full ? status(value, {full: true}) : status(value));
}

export function wait(value, {full = false} = {}) {
  if (full) return sanitize({...value, agent_id: value.id}, {full: true});
  const out = status(value);
  for (const key of ['wait_outcome', 'next_action']) if (value[key] !== undefined) out[key] = value[key];
  // Only a settled wait gets the final answer, once. Partial streaming text is
  // deliberately never part of this projection.
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

export function eventProjection(row, {includeToolEvents = false, fullEventId = undefined} = {}) {
  const type = row.type;
  const dataObj = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  const nestedType = dataObj?.event?.type;
  const text = assistantText(dataObj);
  if (type === 'assistant/message' || type.endsWith('/assistant/message') || nestedType === 'assistant/message')
    return {event_id: row.seq, seq: row.seq, type: 'assistant/message', text};
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

export function events(rows, {includeToolEvents = false, eventId, maxChars = 12000} = {}) {
  const selected = [];
  let used = 0;
  for (const row of rows) {
    const item = eventProjection(row, {includeToolEvents, fullEventId: eventId});
    if (!item) continue;
    const size = JSON.stringify(item).length;
    if (selected.length && used + size > maxChars) break;
    if (!selected.length && size > maxChars) { selected.push(item); used += size; break; }
    selected.push(item); used += size;
  }
  return selected;
}
