// Package notify renders the notification catalog into a recipient's language.
//
// The catalog itself is generated from packages/shared/src/notification-templates.ts
// (see templates_gen.go). Only the rendering algorithm lives here, because an
// algorithm is not data and generating it would buy nothing.
package notify

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// DefaultLocale matches i18next's fallbackLng in apps/web/src/lib/i18n.ts. A
// locale the catalog does not carry falls back rather than rendering the raw
// template, which would put a placeholder into an email.
const DefaultLocale = "id"

// placeholder matches the i18next subset the templates are allowed to use:
// {{name}} and {{name, format}}. Anything wider would let a template ask for
// formatting one of the two renderers cannot do.
var placeholder = regexp.MustCompile(`\{\{(\w+)(?:,\s*(\w+))?\}\}`)

// Render returns the title and message for a template key in a locale.
//
// The third result is false for a key the catalog does not carry, which the
// caller must treat as a failure rather than sending an empty notification: an
// unknown key means the generated table and the handler have parted company.
func Render(key, locale string, params map[string]any) (string, string, bool) {
	entry, ok := Templates[key]
	if !ok {
		return "", "", false
	}
	tmpl, ok := entry.ByLocale[locale]
	if !ok {
		tmpl, ok = entry.ByLocale[DefaultLocale]
		if !ok {
			return "", "", false
		}
	}
	return interpolate(tmpl.Title, params), interpolate(tmpl.Message, params), true
}

// interpolate substitutes params into one template string.
//
// A placeholder with no matching param is left standing, matching the
// missingInterpolationHandler the frontend sets. A visible '{{amount}}' is a
// bug report; an empty gap is a sentence that reads as finished and is wrong.
func interpolate(template string, params map[string]any) string {
	return placeholder.ReplaceAllStringFunc(template, func(match string) string {
		groups := placeholder.FindStringSubmatch(match)
		value, present := params[groups[1]]
		if !present {
			return match
		}
		if groups[2] == "currency" {
			amount, ok := asInt64(value)
			if !ok {
				return match
			}
			return FormatCurrency(amount)
		}
		return stringify(value)
	})
}

// FormatCurrency groups Rupiah by threes with a dot, the way the frontend's
// formatNotificationCurrency does. Both sides render money, so both have to
// agree on it.
func FormatCurrency(value int64) string {
	sign := ""
	if value < 0 {
		sign = "-"
		value = -value
	}
	digits := strconv.FormatInt(value, 10)
	var b strings.Builder
	for i := 0; i < len(digits); i++ {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteByte(digits[i])
	}
	return fmt.Sprintf("%sRp %s", sign, b.String())
}

// asInt64 accepts the shapes a JSON payload can deliver a rupiah amount in.
// json.Unmarshal into any gives float64, so int64 alone would silently refuse
// every amount that arrived over NATS.
func asInt64(value any) (int64, bool) {
	switch v := value.(type) {
	case int:
		return int64(v), true
	case int64:
		return v, true
	case float64:
		return int64(v), true
	case string:
		parsed, err := strconv.ParseInt(v, 10, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

// stringify keeps whole numbers whole. A float64 carrying an integer would
// otherwise print as '3e+06' through %v.
func stringify(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case float64:
		if v == float64(int64(v)) {
			return strconv.FormatInt(int64(v), 10)
		}
		return strconv.FormatFloat(v, 'f', -1, 64)
	default:
		return fmt.Sprintf("%v", v)
	}
}
