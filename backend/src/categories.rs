use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Category {
    pub key: String,
    pub label: String,
}

pub struct CategoryRule {
    pub key: &'static str,
    pub keywords: &'static [&'static str],
}

pub const SYSTEM_CATEGORIES: &[CategoryRule] = &[
    CategoryRule {
        key: "income.salary",
        keywords: &["salary", "salaire", "payroll", "virement employeur"],
    },
    CategoryRule {
        key: "food.grocery",
        keywords: &[
            "supermarket",
            "carrefour",
            "leclerc",
            "lidl",
            "aldi",
            "monoprix",
            "auchan",
            "grocery",
        ],
    },
    CategoryRule {
        key: "food.restaurant",
        keywords: &[
            "restaurant",
            "uber eats",
            "deliveroo",
            "mcdonalds",
            "burger king",
            "kfc",
            "starbucks",
        ],
    },
    CategoryRule {
        key: "transport.fuel",
        keywords: &["total", "shell", "esso", "station", "fuel", "essence"],
    },
    CategoryRule {
        key: "transport.public",
        keywords: &["sncf", "ratp", "uber", "bolt", "train", "metro", "bus"],
    },
    CategoryRule {
        key: "housing.rent",
        keywords: &["rent", "loyer", "immobilier"],
    },
    CategoryRule {
        key: "housing.utilities",
        keywords: &[
            "edf",
            "engie",
            "water",
            "electricity",
            "gaz",
            "internet",
            "free mobile",
            "orange",
            "sfr",
        ],
    },
    CategoryRule {
        key: "leisure.subscription",
        keywords: &[
            "netflix",
            "spotify",
            "disney+",
            "amazon prime",
            "apple.com",
            "icloud",
        ],
    },
    CategoryRule {
        key: "shopping.general",
        keywords: &["amazon", "ebay", "aliexpress", "decathlon", "fnac", "darty"],
    },
];

pub fn list_categories() -> Vec<Category> {
    SYSTEM_CATEGORIES
        .iter()
        .map(|rule| Category {
            key: rule.key.to_string(),
            label: format_label(rule.key),
        })
        .collect()
}

fn format_label(key: &str) -> String {
    key.split('.')
        .next_back()
        .unwrap_or(key)
        .replace('_', " ")
        .chars()
        .enumerate()
        .map(|(i, c)| {
            if i == 0 {
                c.to_uppercase().to_string()
            } else {
                c.to_string()
            }
        })
        .collect()
}

pub fn auto_categorize(description: &str) -> Option<String> {
    let lower_description = description.to_lowercase();

    for rule in SYSTEM_CATEGORIES {
        for keyword in rule.keywords {
            if lower_description.contains(keyword) {
                return Some(rule.key.to_string());
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categorizes_known_keywords() {
        assert_eq!(
            auto_categorize("CARREFOUR MARKET").as_deref(),
            Some("food.grocery")
        );
        assert_eq!(
            auto_categorize("Netflix Subscription").as_deref(),
            Some("leisure.subscription")
        );
        assert_eq!(
            auto_categorize("SNCF VOYAGE").as_deref(),
            Some("transport.public")
        );
    }

    #[test]
    fn returns_none_for_unknown_description() {
        assert_eq!(auto_categorize("UNKNOWN TRANSACTION"), None);
    }

    #[test]
    fn formats_labels_correctly() {
        assert_eq!(format_label("food.grocery"), "Grocery");
        assert_eq!(format_label("income.salary_bonus"), "Salary bonus");
    }
}
