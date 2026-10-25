import { isCalendarDate } from "@/lib/schemas/forms/formats";

// I formati di stringa che Elysia 1.4.30 registra nel FormatRegistry di TypeBox
// (`elysia/dist/type-system/format.mjs`, regex da ajv-formats, MIT © 2020
// Evgeny Poberezkin), copiati così come sono: i gemelli Zod devono accettare e
// rifiutare le stesse stringhe dello schema TypeBox (D5 del piano Hono). I
// formati Zod predefiniti (`z.email()`, `z.uuid()`, `z.iso.datetime()`)
// accettano cose diverse e non si usano.
const EMAIL =
	/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const UUID = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const URI =
	/^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
const ISO_8601 =
	/(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))/;
const FORMAL_DATE =
	/(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{2}\s\d{4}\s\d{2}:\d{2}:\d{2}\sGMT(?:\+|-)\d{4}\s\([^)]+\)/;
const SHORTEN_DATE =
	/^(?:(?:(?:(?:0?[1-9]|[12][0-9]|3[01])[/\s-](?:0?[1-9]|1[0-2])[/\s-](?:19|20)\d{2})|(?:(?:19|20)\d{2}[/\s-](?:0?[1-9]|1[0-2])[/\s-](?:0?[1-9]|[12][0-9]|3[01]))))(?:\s(?:1[012]|0?[1-9]):[0-5][0-9](?::[0-5][0-9])?(?:\s[AP]M)?)?$/;
const NOT_URI_FRAGMENT = /\/|:/;
const STRICT_DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
const DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
const DATE_TIME_SEPARATOR = /t|\s/i;

function isLeapYear(year: number) {
	return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function strictDate(value: string) {
	const m = STRICT_DATE.exec(value);
	if (!m) return false;
	const year = +m[1];
	const month = +m[2];
	const day = +m[3];
	return (
		month >= 1 &&
		month <= 12 &&
		day >= 1 &&
		day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month])
	);
}

function strictTime(value: string) {
	const m = TIME.exec(value);
	if (!m) return false;
	const hr = +m[1];
	const min = +m[2];
	const sec = +m[3];
	const tz = m[4];
	const tzSign = m[5] === "-" ? -1 : 1;
	const tzH = +(m[6] || 0);
	const tzM = +(m[7] || 0);
	if (tzH > 23 || tzM > 59 || !tz) return false;
	if (hr <= 23 && min <= 59 && sec < 60) return true;
	const utcMin = min - tzM * tzSign;
	const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
	return (
		(utcHr === 23 || utcHr === -1) &&
		(utcMin === 59 || utcMin === -1) &&
		sec < 61
	);
}

function strictDateTime(value: string) {
	const parts = value.split(DATE_TIME_SEPARATOR);
	return parts.length === 2 && strictDate(parts[0]) && strictTime(parts[1]);
}

/** «2026-01-01 12:00:00 +0100» → «…+0100» con il segno: come Elysia prima di `new Date`. */
export function parseDateTimeEmptySpace(value: string): string {
	return value.charCodeAt(value.length - 6) === 32
		? `${value.slice(0, -6)}+${value.slice(-5)}`
		: value;
}

// Il `date` e il `date-time` di Elysia sono larghi: ISO, data «formale» di
// `Date.toString()`, gg/mm/aaaa, oltre al formato RFC 3339 stretto.
function lenientDate(strict: (value: string) => boolean, emptySpace: boolean) {
	return (value: string) => {
		const temp = (emptySpace ? parseDateTimeEmptySpace(value) : value).replace(
			/"/g,
			"",
		);
		if (
			ISO_8601.test(temp) ||
			FORMAL_DATE.test(temp) ||
			SHORTEN_DATE.test(temp) ||
			strict(temp)
		)
			return !Number.isNaN(new Date(temp).getTime());
		return false;
	};
}

export const FORMATS = {
	email: (value: string) => EMAIL.test(value),
	uuid: (value: string) => UUID.test(value),
	uri: (value: string) => NOT_URI_FRAGMENT.test(value) && URI.test(value),
	date: lenientDate(strictDate, true),
	"date-time": lenientDate(strictDateTime, false),
	"calendar-date": isCalendarDate,
} satisfies Record<string, (value: string) => boolean>;

export type FormatName = keyof typeof FORMATS;

// Formati che Elysia usa per la coercizione di query, params e t.Integer.
export const isNumericString = (value: string) =>
	!!value && !Number.isNaN(+value);
export const isIntegerString = (value: string) =>
	!!value && Number.isInteger(+value);
export const isBooleanString = (value: string) =>
	value === "true" || value === "false";
