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
        keywords: &[
            "salary",
            "salaire",
            "payroll",
            "payfit",
            "employeur",
            "traitement",
            "remuneration",
        ],
    },
    CategoryRule {
        key: "income.social",
        keywords: &["caf", "social", "allocations", "apl", "rsa", "cpam"],
    },
    CategoryRule {
        key: "finance.cash_withdrawal",
        keywords: &["retrait dab"],
    },
    CategoryRule {
        key: "finance.fees",
        keywords: &[
            "cotis cp parcours j",
            "retro cp parcours j",
            "frais satd",
            "saisie admin tiers",
            "blocage saisie adm",
        ],
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
            "vandis hyper",
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
            "temple bar",
            "bar factory",
            "les docks",
            "sotavento",
            "la taberna",
            "meltdown",
            "resto",
        ],
    },
    CategoryRule {
        key: "transport.fuel",
        keywords: &["total", "shell", "esso", "station", "fuel", "essence"],
    },
    CategoryRule {
        key: "transport.public",
        keywords: &[
            "sncf",
            "ratp",
            "uber",
            "bolt",
            "train",
            "metro",
            "bus",
            "service navigo",
            "navigo",
            "lignesdazur",
            "comutitres",
            "veloway",
        ],
    },
    CategoryRule {
        key: "transport.parking",
        keywords: &["parking"],
    },
    CategoryRule {
        key: "transport.tolls",
        keywords: &["escota", "aprr", "sanef", "autoroutes du sud"],
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
            "telecom",
        ],
    },
    CategoryRule {
        key: "leisure.subscription",
        keywords: &[
            "netflix",
            "spotify",
            "disney",
            "amazon prime",
            "apple com",
            "icloud",
            "dow jones",
        ],
    },
    CategoryRule {
        key: "shopping.general",
        keywords: &[
            "amazon",
            "ebay",
            "aliexpress",
            "decathlon",
            "fnac",
            "darty",
            "ikea",
            "commercial bd tig",
        ],
    },
    CategoryRule {
        key: "finance.transfer",
        keywords: &[
            "vir livret",
            "livret jeune",
            "livret a",
            "virement de m ",
            "virement de mme ",
            "vir inst m ",
            "vir inst mme ",
            "vir inst mlle ",
            "vir sepa ",
            "vir m ",
            "vir mme ",
            "vir de m ",
            "vir de mme ",
            "vir de mlle ",
            "vir inst ",
        ],
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

pub fn is_valid_category_key(key: &str) -> bool {
    SYSTEM_CATEGORIES.iter().any(|rule| rule.key == key)
}

fn format_label(key: &str) -> String {
    key.split('.')
        .next_back()
        .unwrap_or(key)
        .replace('_', " ")
        .chars()
        .enumerate()
        .map(|(index, character)| {
            if index == 0 {
                character.to_uppercase().to_string()
            } else {
                character.to_string()
            }
        })
        .collect()
}

fn normalize_for_match(description: &str) -> String {
    let normalized = description
        .to_lowercase()
        .replace(['\u{fffd}', 'é', 'è', 'ê', 'ë'], "e")
        .replace(['à', 'â'], "a")
        .replace(['î', 'ï'], "i")
        .replace('ô', "o")
        .replace(['û', 'ù', 'ü'], "u")
        .replace('ç', "c")
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>();

    normalized.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn contains_keyword(normalized_description: &str, keyword: &str) -> bool {
    let normalized_keyword = normalize_for_match(keyword);
    let padded_description = format!(" {normalized_description} ");
    let padded_keyword = format!(" {normalized_keyword} ");

    padded_description.contains(&padded_keyword)
}

pub fn auto_categorize(description: &str) -> Option<String> {
    let normalized_description = normalize_for_match(description);

    for rule in SYSTEM_CATEGORIES {
        for keyword in rule.keywords {
            if contains_keyword(&normalized_description, keyword) {
                return Some(rule.key.to_string());
            }
        }
    }

    None
}

pub fn is_probable_legacy_salary_misclassification(description: &str) -> bool {
    let normalized_description = normalize_for_match(description);

    auto_categorize(description).as_deref() != Some("income.salary") && normalized_description.contains("vir")
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
            auto_categorize("SERVICE NAVIGO").as_deref(),
            Some("transport.public")
        );
        assert_eq!(
            auto_categorize("ESCOTA").as_deref(),
            Some("transport.tolls")
        );
        assert_eq!(
            auto_categorize("F COTIS CP PARCOURS J+").as_deref(),
            Some("finance.fees")
        );
        assert_eq!(
            auto_categorize("VIR LIVRET JEUNE").as_deref(),
            Some("finance.transfer")
        );
        assert_eq!(
            auto_categorize("VIR CAF MEURTHE ET MOSELLE").as_deref(),
            Some("income.social")
        );
        assert_eq!(
            auto_categorize("RETRAIT DAB 1201 CITY CENTER").as_deref(),
            Some("finance.cash_withdrawal")
        );
        assert_eq!(
            auto_categorize("PAYMENT PARKING GARAGE CENTRAL").as_deref(),
            Some("transport.parking")
        );
        assert_eq!(
            auto_categorize("RESTAURANT DU CENTRE").as_deref(),
            Some("food.restaurant")
        );
        assert_eq!(
            auto_categorize("MONOPRIX MARKET").as_deref(),
            Some("food.grocery")
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

    #[test]
    fn validates_known_category_keys() {
        assert!(is_valid_category_key("food.grocery"));
        assert!(!is_valid_category_key("unknown.category"));
    }

    #[test]
    fn flags_legacy_salary_false_positives() {
        assert!(is_probable_legacy_salary_misclassification("VIR DE M SOMEONE"));
        assert!(!is_probable_legacy_salary_misclassification(
            "SALAIRE EMPLOYEUR ACME"
        ));
        assert!(!is_probable_legacy_salary_misclassification(
            "PAIEMENT CB CORPORATE MEAL VOUCHER"
        ));
    }

    #[test]
    fn avoids_partial_word_false_positives() {
        assert_eq!(
            auto_categorize("TRAVEL BY BUS TO WORK").as_deref(),
            Some("transport.public")
        );
        assert_eq!(auto_categorize("BARBUSS CORNER SHOP"), None);
    }
}
