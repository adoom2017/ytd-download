use once_cell::sync::Lazy;
use regex::Regex;

use crate::models::TaskProgress;

const PROGRESS_PREFIX: &str = "__STREAMNEST_PROGRESS__";
const FILE_PREFIX: &str = "__STREAMNEST_FILE__";

static PERCENT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[^0-9.]").expect("valid regex"));

pub enum ParsedLine {
    Progress(TaskProgress),
    Processing(String),
    File(String),
    Ignore,
}

pub fn parse_output_line(line: &str) -> ParsedLine {
    let clean = line.trim();
    if let Some(payload) = clean.strip_prefix(PROGRESS_PREFIX) {
        let values: Vec<_> = payload.split('|').collect();
        if values.len() >= 6 {
            return ParsedLine::Progress(TaskProgress {
                percent: parse_percent(values[0]),
                downloaded_bytes: parse_u64(values[1]),
                total_bytes: parse_u64(values[2]).or_else(|| parse_u64(values[3])),
                speed_bytes_per_second: parse_f64(values[4]),
                eta_seconds: parse_f64(values[5]),
                stage: "正在下载".into(),
            });
        }
    }
    if let Some(path) = clean.strip_prefix(FILE_PREFIX) {
        return ParsedLine::File(path.trim().to_string());
    }
    if clean.starts_with("[Merger]") || clean.starts_with("[VideoConvertor]") || clean.starts_with("[ExtractAudio]") || clean.starts_with("[Fixup") {
        return ParsedLine::Processing("正在合并与转换".into());
    }
    ParsedLine::Ignore
}

fn parse_percent(value: &str) -> f64 {
    PERCENT_RE.replace_all(value, "").parse::<f64>().unwrap_or(0.0).clamp(0.0, 100.0)
}

fn parse_u64(value: &str) -> Option<u64> {
    let value = value.trim();
    if value.is_empty() || value == "NA" || value == "None" { None } else { value.parse().ok() }
}

fn parse_f64(value: &str) -> Option<f64> {
    let value = value.trim();
    if value.is_empty() || value == "NA" || value == "None" { None } else { value.parse().ok() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_progress_with_estimated_total() {
        match parse_output_line("__STREAMNEST_PROGRESS__ 42.5%|425|NA|1000|200|3") {
            ParsedLine::Progress(progress) => {
                assert_eq!(progress.percent, 42.5);
                assert_eq!(progress.total_bytes, Some(1000));
                assert_eq!(progress.eta_seconds, Some(3.0));
            }
            _ => panic!("expected progress"),
        }
    }

    #[test]
    fn parses_completed_file() {
        match parse_output_line("__STREAMNEST_FILE__C:/Downloads/test.mp4") {
            ParsedLine::File(path) => assert!(path.ends_with("test.mp4")),
            _ => panic!("expected file"),
        }
    }
}

