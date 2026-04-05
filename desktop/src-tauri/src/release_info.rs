//! GitHub Releases API for latest Orateur version (no hardcoded semver in the app).

use serde::Deserialize;

const GITHUB_API_LATEST: &str =
    "https://api.github.com/repos/orateurhq/orateur/releases/latest";
const USER_AGENT: &str = "Orateur-Desktop/1.0";

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
}

#[derive(Debug)]
pub struct LatestRelease {
    /// Semver without leading `v` (e.g. `0.1.4`).
    pub semver: String,
}

pub fn fetch_latest_release() -> Result<LatestRelease, String> {
    let release: GhRelease = ureq::get(GITHUB_API_LATEST)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("GitHub API: {e}"))?
        .into_json()
        .map_err(|e| format!("GitHub API JSON: {e}"))?;

    let semver = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name)
        .trim()
        .to_string();

    if semver.is_empty() {
        return Err("GitHub API returned empty tag".to_string());
    }

    Ok(LatestRelease { semver })
}

#[cfg(not(unix))]
pub fn wheel_url_for_version(semver: &str) -> String {
    format!(
        "https://github.com/orateurhq/orateur/releases/download/v{semver}/orateur-{semver}-py3-none-any.whl"
    )
}

/// Parse `orateur --version` output (e.g. `orateur 0.1.3`) to semver string.
pub fn parse_cli_version(output: &str) -> Option<String> {
    let s = output.trim();
    let last = s.split_whitespace().last()?;
    if last
        .chars()
        .all(|c| c.is_ascii_digit() || c == '.')
        && last.contains('.')
    {
        return Some(last.to_string());
    }
    None
}

pub fn semver_to_parts(s: &str) -> Vec<u32> {
    s.split('.')
        .filter_map(|p| p.parse::<u32>().ok())
        .collect()
}

pub fn semver_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let pa = semver_to_parts(a);
    let pb = semver_to_parts(b);
    let n = pa.len().max(pb.len());
    for i in 0..n {
        let va = *pa.get(i).unwrap_or(&0);
        let vb = *pb.get(i).unwrap_or(&0);
        match va.cmp(&vb) {
            std::cmp::Ordering::Equal => continue,
            o => return o,
        }
    }
    std::cmp::Ordering::Equal
}
