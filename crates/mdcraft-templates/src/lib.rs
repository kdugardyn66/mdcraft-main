//! The Markdown templates shipped with mdcraft: Word-style documents and
//! PowerPoint-style slide decks.
//!
//! Each template is a Markdown file in `templates/` at the repository root, compiled
//! in with `include_str!`. Templates are our own text (no Microsoft Office content).
//! They may contain placeholders that [`instantiate`] fills in:
//!
//! | Placeholder | Example |
//! |---|---|
//! | `{{author}}` | Kris Dugardyn |
//! | `{{date}}` | 2026-10-14 |
//! | `{{date_long}}` | 14 October 2026 |
//! | `{{month_year}}` | October 2026 |
//! | `{{year}}` / `{{next_year}}` | 2026 / 2027 |
//! | `{{quarter}}` | Q4 2026 |

#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

/// What a template makes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// A Word-style document (pages).
    Document,
    /// A PowerPoint-style deck (`<!-- slide -->` markers).
    Presentation,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Template {
    /// Stable id (`report`, `pitch`…), used by the CLI and the New page.
    pub id: &'static str,
    pub name: &'static str,
    pub kind: Kind,
    /// One line for the gallery.
    pub description: &'static str,
    /// The theme the template's front matter selects (for the gallery thumbnail).
    pub theme: &'static str,
    /// Words people search for (`cv` finds the résumé).
    pub keywords: &'static str,
    #[serde(skip)]
    pub source: &'static str,
}

macro_rules! t {
    ($id:literal, $name:literal, $kind:ident, $theme:literal, $file:literal, $desc:literal, $kw:literal) => {
        Template {
            id: $id,
            name: $name,
            kind: Kind::$kind,
            description: $desc,
            theme: $theme,
            keywords: $kw,
            source: include_str!(concat!("../../../templates/", $file)),
        }
    };
}

static TEMPLATES: &[Template] = &[
    // ---------------------------------------------------------------- documents
    t!("blank", "Blank document", Document, "office", "documents/blank.md", "An empty page with a title, ready to write.", "empty new"),
    t!("welcome", "Welcome to mdcraft", Document, "office", "documents/welcome.md", "A tour of everything mdcraft renders: styles, tables, diagrams, math, charts.", "tour sample help guide"),
    t!("report", "Business report", Document, "report", "documents/report.md", "Cover page, contents, executive summary, findings with charts and tables.", "annual quarterly analysis"),
    t!("proposal", "Project proposal", Document, "office", "documents/proposal.md", "Problem, solution, scope, timeline (Gantt), budget and sign-off.", "plan bid quote"),
    t!("letter", "Formal letter", Document, "letter", "documents/letter.md", "A business letter with letterhead, address block and signature.", "correspondence mail cover"),
    t!("memo", "Memo", Document, "office", "documents/memo.md", "A one-page internal memo with To / From / Subject block.", "memorandum note internal"),
    t!("minutes", "Meeting minutes", Document, "office", "documents/minutes.md", "Attendees, agenda, decisions and an action-item checklist.", "meeting notes agenda actions"),
    t!("resume", "Résumé", Document, "modern", "documents/resume.md", "A clean one-page CV: profile, experience, skills, education.", "cv curriculum vitae job"),
    t!("spec", "Technical specification", Document, "modern", "documents/spec.md", "Design doc with architecture diagram, API table, sequence diagram, risks.", "design doc rfc architecture engineering"),
    t!("paper", "Research paper", Document, "classic", "documents/paper.md", "Academic paper with abstract, equations, figures, footnotes and references.", "academic thesis article science math"),
    t!("newsletter", "Newsletter", Document, "newsletter", "documents/newsletter.md", "A team newsletter with a masthead, highlights and two-column stories.", "bulletin update news"),
    // ---------------------------------------------------------------- presentations
    t!("blank-deck", "Blank presentation", Presentation, "paper", "slides/blank.md", "A title slide and a content slide.", "empty slides deck new"),
    t!("pitch", "Pitch deck", Presentation, "aurora", "slides/pitch.md", "Problem, solution, market, traction, business model, team, the ask.", "startup investor fundraising"),
    t!("status", "Project status update", Presentation, "corporate", "slides/status.md", "RAG status, milestones, risks and next steps for a steering meeting.", "steering report progress"),
    t!("qbr", "Quarterly business review", Presentation, "paper", "slides/qbr.md", "KPIs, revenue chart, wins and misses, priorities for next quarter.", "kpi metrics review results"),
    t!("training", "Training workshop", Presentation, "sunrise", "slides/training.md", "Agenda, learning objectives, exercises, quiz and wrap-up.", "course lesson onboarding"),
    t!("tech-talk", "Tech talk", Presentation, "midnight", "slides/tech-talk.md", "A conference talk with code, architecture diagrams and benchmarks.", "conference engineering code"),
    t!("lecture", "Lecture", Presentation, "chalk", "slides/lecture.md", "A university lecture with definitions, equations and worked examples.", "class teaching math science"),
    t!("launch", "Product launch", Presentation, "ocean", "slides/launch.md", "Vision, features, roadmap timeline, pricing and launch plan.", "release roadmap marketing"),
];

/// Every template, documents first.
pub fn all() -> &'static [Template] {
    TEMPLATES
}

pub fn get(id: &str) -> Option<&'static Template> {
    TEMPLATES.iter().find(|t| t.id.eq_ignore_ascii_case(id.trim()))
}

/// Templates whose name, id, description or keywords contain every word of `query`.
pub fn search(query: &str) -> Vec<&'static Template> {
    let words: Vec<String> = query.split_whitespace().map(fold).collect();
    TEMPLATES
        .iter()
        .filter(|t| {
            let hay = fold(&format!("{} {} {} {}", t.id, t.name, t.description, t.keywords));
            words.iter().all(|w| hay.contains(w.as_str()))
        })
        .collect()
}

/// Lowercase without the accents people don't type (`résumé` → `resume`).
fn fold(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            other => other,
        })
        .collect()
}

/// Values for the placeholders.
#[derive(Clone, Debug)]
pub struct Vars {
    pub author: String,
    pub year: i64,
    pub month: u32,
    pub day: u32,
}

const MONTHS: [&str; 12] =
    ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

impl Vars {
    fn month_name(&self) -> &'static str {
        MONTHS.get(self.month.saturating_sub(1) as usize).copied().unwrap_or("January")
    }
    pub fn pairs(&self) -> Vec<(&'static str, String)> {
        vec![
            ("author", self.author.clone()),
            ("date", format!("{:04}-{:02}-{:02}", self.year, self.month, self.day)),
            ("date_long", format!("{} {} {}", self.day, self.month_name(), self.year)),
            ("month_year", format!("{} {}", self.month_name(), self.year)),
            ("year", self.year.to_string()),
            ("next_year", (self.year + 1).to_string()),
            ("quarter", format!("Q{} {}", (self.month.clamp(1, 12) - 1) / 3 + 1, self.year)),
        ]
    }
}

/// The template's Markdown with its placeholders filled in.
pub fn instantiate(t: &Template, vars: &Vars) -> String {
    fill(t.source, vars)
}

/// Fills the placeholders in any template text (custom templates use the same ones).
pub fn fill(text: &str, vars: &Vars) -> String {
    let mut out = text.to_string();
    for (k, v) in vars.pairs() {
        out = out.replace(&format!("{{{{{k}}}}}"), &v);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars() -> Vars {
        Vars { author: "Ada Lovelace".into(), year: 2026, month: 10, day: 14 }
    }

    #[test]
    fn ids_are_unique_and_sources_present() {
        let mut ids: Vec<_> = all().iter().map(|t| t.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), all().len());
        for t in all() {
            assert!(t.source.trim().len() > 20, "{} is empty", t.id);
            assert!(t.source.starts_with("---\n"), "{} has no front matter", t.id);
            assert!(t.source.contains(&format!("theme: {}", t.theme)), "{}: front matter theme differs from the catalog", t.id);
        }
    }

    #[test]
    fn presentations_have_slides_and_documents_do_not() {
        for t in all() {
            let has = t.source.contains("<!-- slide");
            assert_eq!(has, t.kind == Kind::Presentation, "{}", t.id);
        }
    }

    #[test]
    fn placeholders_are_filled() {
        for t in all() {
            let s = instantiate(t, &vars());
            assert!(!s.contains("{{"), "{} keeps a placeholder: {}", t.id, s.lines().find(|l| l.contains("{{")).unwrap_or(""));
        }
        let v = vars().pairs();
        assert!(v.contains(&("quarter", "Q4 2026".to_string())));
        assert!(v.contains(&("date_long", "14 October 2026".to_string())));
    }

    #[test]
    fn search_folds_accents() {
        assert_eq!(search("resume").first().map(|t| t.id), Some("resume"));
        assert_eq!(search("cv").first().map(|t| t.id), Some("resume"));
        assert!(search("").len() == all().len());
    }
}
