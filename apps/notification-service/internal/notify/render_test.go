package notify

import (
	"strings"
	"testing"
)

func TestFormatCurrency(t *testing.T) {
	tests := []struct {
		value int64
		want  string
	}{
		{0, "Rp 0"},
		{7, "Rp 7"},
		{999, "Rp 999"},
		{1000, "Rp 1.000"},
		{18000000, "Rp 18.000.000"},
		{7150000, "Rp 7.150.000"},
		{1000000000, "Rp 1.000.000.000"},
		{-2500, "-Rp 2.500"},
	}
	for _, tt := range tests {
		if got := FormatCurrency(tt.value); got != tt.want {
			t.Errorf("FormatCurrency(%d) = %q, want %q", tt.value, got, tt.want)
		}
	}
}

func TestInterpolate(t *testing.T) {
	tests := []struct {
		name     string
		template string
		params   map[string]any
		want     string
	}{
		{"plain value", "Status is {{status}}.", map[string]any{"status": "matched"}, "Status is matched."},
		{"two values", "{{a}} and {{b}}", map[string]any{"a": "x", "b": "y"}, "x and y"},
		{"currency format", "Paid {{amount, currency}}.", map[string]any{"amount": 7150000}, "Paid Rp 7.150.000."},
		// json.Unmarshal into any hands every number over as float64, so an
		// int64-only conversion would refuse every amount that arrived on NATS.
		{"currency from json float", "{{amount, currency}}", map[string]any{"amount": float64(3000000)}, "Rp 3.000.000"},
		{"integral float stays whole", "{{days}} days", map[string]any{"days": float64(7)}, "7 days"},
		// A visible placeholder is a bug report; a blank is a sentence that
		// reads as finished and is wrong.
		{"missing param is left standing", "Hi {{name}}", nil, "Hi {{name}}"},
		{"unparseable currency is left standing", "{{amount, currency}}", map[string]any{"amount": "abc"}, "{{amount, currency}}"},
		{"no placeholders", "Nothing to fill.", map[string]any{"a": 1}, "Nothing to fill."},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := interpolate(tt.template, tt.params); got != tt.want {
				t.Errorf("interpolate() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestRender(t *testing.T) {
	t.Run("renders the requested locale", func(t *testing.T) {
		title, message, ok := Render("notification.milestone_approved", "en",
			map[string]any{"amount": 5000000})
		if !ok {
			t.Fatal("ok = false, want true")
		}
		if title != "Milestone approved" {
			t.Errorf("title = %q", title)
		}
		if !strings.Contains(message, "Rp 5.000.000") {
			t.Errorf("message = %q, want the formatted amount", message)
		}
	})

	t.Run("falls back rather than emitting a raw template", func(t *testing.T) {
		_, message, ok := Render("notification.project_completed", "fr", nil)
		if !ok {
			t.Fatal("ok = false, want the default locale")
		}
		id := Templates["notification.project_completed"].ByLocale[DefaultLocale].Message
		if message != id {
			t.Errorf("message = %q, want the default locale %q", message, id)
		}
	})

	t.Run("reports an unknown key", func(t *testing.T) {
		if _, _, ok := Render("notification.nope", "id", nil); ok {
			t.Error("ok = true, want false for a key the catalog does not carry")
		}
	})
}

// Every template must ship in both languages, or a reader in the missing one
// silently falls back and nobody finds out.
func TestTemplatesCoverBothLocales(t *testing.T) {
	if len(Templates) == 0 {
		t.Fatal("the generated catalog is empty")
	}
	for key, entry := range Templates {
		for _, locale := range []string{"id", "en"} {
			tmpl, ok := entry.ByLocale[locale]
			if !ok {
				t.Errorf("%s has no %s translation", key, locale)
				continue
			}
			if strings.TrimSpace(tmpl.Title) == "" || strings.TrimSpace(tmpl.Message) == "" {
				t.Errorf("%s [%s] has empty wording", key, locale)
			}
		}
	}
}

// The two languages must ask for the same params, or one of them renders a
// placeholder the handler never supplies.
func TestTranslationsUseTheSamePlaceholders(t *testing.T) {
	for key, entry := range Templates {
		id := placeholder.FindAllString(entry.ByLocale["id"].Title+" "+entry.ByLocale["id"].Message, -1)
		en := placeholder.FindAllString(entry.ByLocale["en"].Title+" "+entry.ByLocale["en"].Message, -1)
		if !sameSet(id, en) {
			t.Errorf("%s asks for %v in Indonesian and %v in English", key, id, en)
		}
	}
}

func sameSet(a, b []string) bool {
	seen := map[string]int{}
	for _, v := range a {
		seen[v]++
	}
	for _, v := range b {
		seen[v]--
	}
	for _, n := range seen {
		if n != 0 {
			return false
		}
	}
	return true
}
