import { CURRENCIES, type Currency } from '@vigil/money';
/** Aggregate minor-unit strings may exceed BIGINT; formatting never passes through Number. */
export function money(value: unknown, code: unknown): string {
  if (value === null || value === undefined) return 'UNKNOWN';
  if (
    typeof value !== 'string' ||
    !/^(-?[0-9]+)$/.test(value) ||
    typeof code !== 'string' ||
    !Object.hasOwn(CURRENCIES, code)
  )
    return 'UNKNOWN';
  const scale = CURRENCIES[code as Currency].minorUnitScale;
  const negative = value.startsWith('-');
  const raw = (negative ? value.slice(1) : value).padStart(scale + 1, '0');
  const whole = (scale ? raw.slice(0, -scale) : raw).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ',',
  );
  return `${code} ${negative ? '-' : ''}${whole}${scale ? '.' + raw.slice(-scale) : ''}`;
}
export function percentage(numerator: string, denominator: string): string {
  if (!/^\d+$/.test(numerator) || !/^\d+$/.test(denominator)) return 'UNKNOWN';
  const d = BigInt(denominator),
    n = BigInt(numerator);
  if (d === 0n) return 'Not evaluated';
  if (n > d) return 'UNKNOWN';
  const tenths = (n * 1000n) / d;
  return `${tenths / 10n}.${tenths % 10n}%`;
}
export interface TimestampPresentation {
  text: string;
  source?: string;
  iso?: string;
  epochMs?: number;
  note?: string;
}
/** Normalize explicit offsets at whole-second precision; retain every fractional digit. */
export function timestampPresentation(value: unknown): TimestampPresentation {
  if (value === undefined) return { text: 'Unavailable (not supplied)' };
  if (value === null) return { text: 'Not recorded' };
  if (typeof value !== 'string')
    return { text: 'Timestamp unavailable (invalid value)' };
  const fallback = {
    source: value,
    text: 'Timestamp cannot be interpreted safely; source retained',
  };
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}(?::?\d{2})?)$/.exec(
      value,
    );
  if (!match)
    return {
      ...fallback,
      text: /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(
        value,
      )
        ? 'Timezone not supplied; UTC not inferred'
        : fallback.text,
    };
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]),
    hour = Number(match[4]),
    minute = Number(match[5]),
    second = Number(match[6]);
  const fraction = match[7];
  const zone = match[8]!;
  const offset = /^[Zz]$/.test(zone)
    ? [0, 0]
    : [Number(zone.slice(1, 3)), Number(zone.slice(3).replace(':', '') || '0')];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offset[0]! > 23 ||
    offset[1]! > 59
  )
    return fallback;
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, 0);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day
  )
    return fallback;
  const offsetMinutes =
    (offset[0]! * 60 + offset[1]!) * (zone.startsWith('-') ? -1 : 1);
  const whole = new Date(local.getTime() - offsetMinutes * 60000);
  if (whole.getUTCFullYear() < 0 || whole.getUTCFullYear() > 9999)
    return fallback;
  const iso =
    whole.toISOString().slice(0, 19) +
    (fraction === undefined ? '' : '.' + fraction) +
    'Z';
  return {
    text: iso.replace('T', ' ').replace('Z', ' UTC'),
    source: value,
    iso,
    epochMs:
      whole.getTime() + Number((fraction ?? '').slice(0, 3).padEnd(3, '0')),
    ...(/^-(?:00)(?::?00)?$/.test(zone)
      ? { note: 'Source local offset is unknown; the UTC instant is supplied.' }
      : {}),
  };
}
export function timestamp(value: unknown): string {
  return timestampPresentation(value).text;
}
export function age(value: unknown, asOf: string): string {
  if (value === null) return 'Not recorded';
  if (value === undefined) return 'Unavailable (not supplied)';
  const start = timestampPresentation(value).epochMs,
    end = timestampPresentation(asOf).epochMs;
  if (start === undefined || end === undefined) return 'UNKNOWN';
  const elapsed = end - start;
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'UNKNOWN';
  const minutes = Math.floor(elapsed / 60000);
  return minutes < 60
    ? `${minutes}m`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)}h`
      : `${Math.floor(minutes / 1440)}d`;
}
