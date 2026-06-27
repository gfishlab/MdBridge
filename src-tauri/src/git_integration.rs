use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitStatus {
    pub repo_root: String,
    pub branch: String,
    pub changed_files: usize,
    pub ahead: usize,
    pub behind: usize,
    pub has_remote: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub summary: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
    pub kind: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitCommitGraphEntry {
    pub graph: String,
    pub short_hash: String,
    pub refs: String,
    pub summary: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitConflictFile {
    pub path: String,
    pub base: String,
    pub ours: String,
    pub theirs: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitOperationResult {
    pub message: String,
}

struct GitFileContext {
    repo_root: PathBuf,
    relative_path: String,
}

pub fn parse_status_output(repo_root: &str, output: &str) -> GitStatus {
    let mut lines = output.lines();
    let branch_line = lines.next().unwrap_or_default();
    let changed_files = lines.filter(|line| !line.trim().is_empty()).count();
    let (branch, has_remote, ahead, behind) = parse_branch_status(branch_line);

    GitStatus {
        repo_root: repo_root.into(),
        branch,
        changed_files,
        ahead,
        behind,
        has_remote,
    }
}

pub fn parse_log_line(line: &str) -> Option<GitCommit> {
    let parts = line.splitn(6, '\u{1f}').collect::<Vec<_>>();
    if parts.len() != 6 || parts[0].is_empty() {
        return None;
    }

    Some(GitCommit {
        hash: parts[0].into(),
        short_hash: parts[1].into(),
        author_name: parts[2].into(),
        author_email: parts[3].into(),
        authored_at: parts[4].into(),
        summary: parts[5].into(),
    })
}

pub fn parse_branch_output(output: &str) -> Vec<GitBranch> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '|');
            let marker = parts.next()?.trim();
            let name = parts.next()?.trim();
            let kind = parts.next()?.trim();
            if name.is_empty() {
                return None;
            }
            Some(GitBranch {
                name: name.into(),
                current: marker == "*",
                kind: kind.into(),
            })
        })
        .collect()
}

pub fn parse_recent_branch_output(output: &str) -> Vec<GitBranch> {
    let mut branches = Vec::new();

    for line in output.lines() {
        let Some((_, target)) = line.rsplit_once(" to ") else {
            continue;
        };
        let name = target.trim();
        if name.is_empty()
            || name == "HEAD"
            || branches
                .iter()
                .any(|branch: &GitBranch| branch.name == name)
        {
            continue;
        }
        branches.push(GitBranch {
            name: name.into(),
            current: false,
            kind: "recent".into(),
        });
    }

    branches
}

pub fn parse_graph_line(line: &str) -> Option<GitCommitGraphEntry> {
    let parts = line.splitn(3, '\u{1f}').collect::<Vec<_>>();
    if parts.len() != 3 {
        return None;
    }

    let graph_and_hash = parts[0].trim_end();
    let mut hash_start = None;
    for (index, ch) in graph_and_hash.char_indices() {
        if ch.is_ascii_hexdigit() {
            hash_start = Some(index);
            break;
        }
    }

    let hash_start = hash_start?;
    let graph = graph_and_hash[..hash_start].trim().to_string();
    let short_hash = graph_and_hash[hash_start..].trim().to_string();
    if short_hash.is_empty() {
        return None;
    }

    Some(GitCommitGraphEntry {
        graph,
        short_hash,
        refs: parts[1].trim().into(),
        summary: parts[2].trim().into(),
    })
}

pub fn parse_conflict_file_output(output: &str) -> Vec<String> {
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

pub fn get_status(path: &str) -> Result<GitStatus, String> {
    let repo_root = repo_root_for_path(path)?;
    let output = run_git(&repo_root, &["status", "--porcelain=v1", "--branch"])?;
    Ok(parse_status_output(&repo_root.to_string_lossy(), &output))
}

pub fn get_branches(path: &str) -> Result<Vec<GitBranch>, String> {
    let repo_root = repo_root_for_path(path)?;
    let local_output = run_git(
        &repo_root,
        &["branch", "--format=%(HEAD)|%(refname:short)|local"],
    )?;
    let remote_output = run_git(
        &repo_root,
        &["branch", "-r", "--format=%(HEAD)|%(refname:short)|remote"],
    )?;
    let recent_output =
        run_git(&repo_root, &["reflog", "show", "--format=%gs", "HEAD"]).unwrap_or_default();

    let mut branches = parse_branch_output(&local_output);
    branches.extend(parse_branch_output(&remote_output));
    branches.extend(
        parse_recent_branch_output(&recent_output)
            .into_iter()
            .take(8),
    );
    Ok(branches)
}

pub fn get_file_history(path: &str, limit: Option<usize>) -> Result<Vec<GitCommit>, String> {
    let context = file_context(path)?;
    let limit = limit.unwrap_or(80).clamp(1, 200);
    let mut command = git_command(&context.repo_root);
    command
        .arg("log")
        .arg("--follow")
        .arg("--date=iso-strict")
        .arg("--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s")
        .arg(format!("--max-count={}", limit))
        .arg("--")
        .arg(&context.relative_path);
    let output = run_prepared_git(command)?;

    Ok(output.lines().filter_map(parse_log_line).collect())
}

pub fn get_commit_graph(
    path: &str,
    limit: Option<usize>,
) -> Result<Vec<GitCommitGraphEntry>, String> {
    let repo_root = repo_root_for_path(path)?;
    let limit = limit.unwrap_or(80).clamp(1, 200);
    let mut command = git_command(&repo_root);
    command
        .arg("log")
        .arg("--graph")
        .arg("--decorate")
        .arg("--all")
        .arg(format!("--max-count={}", limit))
        .arg("--format=%h%x1f%D%x1f%s");
    let output = run_prepared_git(command)?;
    Ok(output.lines().filter_map(parse_graph_line).collect())
}

pub fn get_file_diff(path: &str, commit: &str) -> Result<String, String> {
    let commit = validate_commit_id(commit)?;
    let context = file_context(path)?;
    let mut command = git_command(&context.repo_root);
    command
        .arg("show")
        .arg("--format=")
        .arg("--find-renames")
        .arg(commit)
        .arg("--")
        .arg(&context.relative_path);
    run_prepared_git(command)
}

pub fn get_conflicts(path: &str) -> Result<Vec<GitConflictFile>, String> {
    let repo_root = repo_root_for_path(path)?;
    let output = run_git(&repo_root, &["diff", "--name-only", "--diff-filter=U"])?;
    let conflict_paths = parse_conflict_file_output(&output);

    Ok(conflict_paths
        .into_iter()
        .map(|relative_path| GitConflictFile {
            base: get_conflict_stage_content(&repo_root, &relative_path, 1).unwrap_or_default(),
            ours: get_conflict_stage_content(&repo_root, &relative_path, 2).unwrap_or_default(),
            theirs: get_conflict_stage_content(&repo_root, &relative_path, 3).unwrap_or_default(),
            path: relative_path,
        })
        .collect())
}

pub fn resolve_conflict(
    path: &str,
    file_path: &str,
    resolution: &str,
) -> Result<GitOperationResult, String> {
    if file_path.trim().is_empty() {
        return Err("冲突文件路径不能为空".into());
    }

    let checkout_flag = match resolution {
        "ours" => "--ours",
        "theirs" => "--theirs",
        _ => return Err("未知冲突解决方式".into()),
    };

    let repo_root = repo_root_for_path(path)?;
    let mut checkout = git_command(&repo_root);
    checkout
        .arg("checkout")
        .arg(checkout_flag)
        .arg("--")
        .arg(file_path);
    run_prepared_git(checkout)?;

    let mut add = git_command(&repo_root);
    add.arg("add").arg("--").arg(file_path);
    run_prepared_git(add)?;

    Ok(GitOperationResult {
        message: format!(
            "已采用{}版本并标记冲突为已解决",
            if resolution == "ours" {
                "当前"
            } else {
                "传入"
            }
        ),
    })
}

pub fn get_file_revision(path: &str, commit: &str) -> Result<String, String> {
    let commit = validate_commit_id(commit)?;
    let context = file_context(path)?;
    let mut command = git_command(&context.repo_root);
    command
        .arg("show")
        .arg(format!("{}:{}", commit, context.relative_path));
    run_prepared_git(command)
}

pub fn restore_file_revision(path: &str, commit: &str) -> Result<String, String> {
    let content = get_file_revision(path, commit)?;
    std::fs::write(path, &content).map_err(|e| format!("写入历史版本失败: {}", e))?;
    Ok(content)
}

pub fn commit_file(path: &str, message: &str) -> Result<GitOperationResult, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("提交信息不能为空".into());
    }

    let context = file_context(path)?;
    let mut add = git_command(&context.repo_root);
    add.arg("add").arg("--").arg(&context.relative_path);
    run_prepared_git(add)?;

    let mut commit = git_command(&context.repo_root);
    commit
        .arg("commit")
        .arg("-m")
        .arg(message)
        .arg("--")
        .arg(&context.relative_path);
    let output = run_prepared_git(commit)?;

    Ok(GitOperationResult {
        message: output.trim().into(),
    })
}

pub fn pull_repository(path: &str) -> Result<GitOperationResult, String> {
    let repo_root = repo_root_for_path(path)?;
    let output = run_git(&repo_root, &["pull", "--no-rebase", "--no-edit"])?;
    Ok(GitOperationResult {
        message: output.trim().into(),
    })
}

pub fn push_repository(path: &str) -> Result<GitOperationResult, String> {
    let repo_root = repo_root_for_path(path)?;
    let output = run_git(&repo_root, &["push"])?;
    Ok(GitOperationResult {
        message: output.trim().into(),
    })
}

fn parse_branch_status(line: &str) -> (String, bool, usize, usize) {
    let Some(raw) = line.strip_prefix("## ") else {
        return ("未知分支".into(), false, 0, 0);
    };

    let (head, meta) = if let Some((head, meta)) = raw.split_once(" [") {
        (head, Some(meta.trim_end_matches(']')))
    } else {
        (raw, None)
    };

    let branch = if let Some(name) = head.strip_prefix("No commits yet on ") {
        name
    } else {
        head.split("...").next().unwrap_or(head)
    };
    let has_remote = head.contains("...");
    let mut ahead = 0;
    let mut behind = 0;

    if let Some(meta) = meta {
        for item in meta.split(',').map(str::trim) {
            if let Some(value) = item.strip_prefix("ahead ") {
                ahead = value.parse().unwrap_or(0);
            } else if let Some(value) = item.strip_prefix("behind ") {
                behind = value.parse().unwrap_or(0);
            }
        }
    }

    (branch.into(), has_remote, ahead, behind)
}

fn validate_commit_id(commit: &str) -> Result<&str, String> {
    if (7..=64).contains(&commit.len()) && commit.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(commit)
    } else {
        Err("非法提交标识".into())
    }
}

fn repo_root_for_path(path: &str) -> Result<PathBuf, String> {
    let input = Path::new(path);
    let work_dir = if input.is_dir() {
        input
    } else {
        input
            .parent()
            .ok_or_else(|| "当前路径没有可用的父目录".to_string())?
    };

    let mut command = git_command(work_dir);
    command.arg("rev-parse").arg("--show-toplevel");
    let output = run_prepared_git(command)?;
    let root = output.trim();
    if root.is_empty() {
        return Err("当前路径不在 Git 仓库中".into());
    }

    let root = PathBuf::from(root);
    Ok(root.canonicalize().unwrap_or(root))
}

fn file_context(path: &str) -> Result<GitFileContext, String> {
    let file_path = Path::new(path);
    if !file_path.is_file() {
        return Err("当前文档必须是已保存的文件".into());
    }

    let repo_root = repo_root_for_path(path)?;
    let canonical_file = file_path.canonicalize().map_err(|e| e.to_string())?;
    let relative_path = canonical_file
        .strip_prefix(&repo_root)
        .map_err(|_| "当前文档不在 Git 仓库中".to_string())?
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");

    Ok(GitFileContext {
        repo_root,
        relative_path,
    })
}

fn git_command(work_dir: &Path) -> Command {
    let mut command = Command::new("git");
    command
        .current_dir(work_dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C");
    command
}

fn run_git(repo_root: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = git_command(repo_root);
    command.args(args);
    run_prepared_git(command)
}

fn run_prepared_git(mut command: Command) -> Result<String, String> {
    let output = command.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "未找到 git 命令，请先安装 Git".to_string()
        } else {
            format!("执行 Git 命令失败: {}", e)
        }
    })?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    Err(if detail.is_empty() {
        "Git 命令执行失败".into()
    } else {
        detail
    })
}

fn get_conflict_stage_content(
    repo_root: &Path,
    relative_path: &str,
    stage: u8,
) -> Result<String, String> {
    let mut command = git_command(repo_root);
    command
        .arg("show")
        .arg(format!(":{}:{}", stage, relative_path));
    run_prepared_git(command)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_branch_output, parse_conflict_file_output, parse_graph_line, parse_log_line,
        parse_recent_branch_output, parse_status_output, GitBranch, GitCommit, GitCommitGraphEntry,
        GitStatus,
    };

    #[test]
    fn parses_status_branch_tracking_and_changed_files() {
        let status = parse_status_output(
            "/repo/docs",
            "## main...origin/main [ahead 2, behind 1]\n M guide.md\n?? draft.md\n",
        );

        assert_eq!(
            status,
            GitStatus {
                repo_root: "/repo/docs".into(),
                branch: "main".into(),
                changed_files: 2,
                ahead: 2,
                behind: 1,
                has_remote: true,
            }
        );
    }

    #[test]
    fn parses_status_without_remote_tracking() {
        let status = parse_status_output("/repo/docs", "## docs-draft\n");

        assert_eq!(
            status,
            GitStatus {
                repo_root: "/repo/docs".into(),
                branch: "docs-draft".into(),
                changed_files: 0,
                ahead: 0,
                behind: 0,
                has_remote: false,
            }
        );
    }

    #[test]
    fn parses_file_history_log_line() {
        let line = "0123456789abcdef\u{1f}0123456\u{1f}Grace Hopper\u{1f}grace@example.com\u{1f}2026-06-27T09:12:30+08:00\u{1f}docs: revise publish checklist";

        assert_eq!(
            parse_log_line(line),
            Some(GitCommit {
                hash: "0123456789abcdef".into(),
                short_hash: "0123456".into(),
                author_name: "Grace Hopper".into(),
                author_email: "grace@example.com".into(),
                authored_at: "2026-06-27T09:12:30+08:00".into(),
                summary: "docs: revise publish checklist".into(),
            })
        );
    }

    #[test]
    fn parses_branch_list_with_current_marker() {
        let branches = parse_branch_output(" |draft|local\n*|main|local\n |origin/main|remote\n");

        assert_eq!(
            branches,
            vec![
                GitBranch {
                    name: "draft".into(),
                    current: false,
                    kind: "local".into(),
                },
                GitBranch {
                    name: "main".into(),
                    current: true,
                    kind: "local".into(),
                },
                GitBranch {
                    name: "origin/main".into(),
                    current: false,
                    kind: "remote".into(),
                },
            ]
        );
    }

    #[test]
    fn parses_recent_branch_names_from_reflog() {
        let branches = parse_recent_branch_output(
            "checkout: moving from feature/docs to main\ncheckout: moving from main to release/v2\ncheckout: moving from release/v2 to main\n",
        );

        assert_eq!(
            branches,
            vec![
                GitBranch {
                    name: "main".into(),
                    current: false,
                    kind: "recent".into(),
                },
                GitBranch {
                    name: "release/v2".into(),
                    current: false,
                    kind: "recent".into(),
                },
            ]
        );
    }

    #[test]
    fn parses_graph_log_lines() {
        let line = "* 0123456\u{1f}HEAD -> main, origin/main\u{1f}docs: update guide";

        assert_eq!(
            parse_graph_line(line),
            Some(GitCommitGraphEntry {
                graph: "*".into(),
                short_hash: "0123456".into(),
                refs: "HEAD -> main, origin/main".into(),
                summary: "docs: update guide".into(),
            })
        );
    }

    #[test]
    fn parses_unmerged_conflict_file_list() {
        assert_eq!(
            parse_conflict_file_output("docs/guide.md\nREADME.md\n\n"),
            vec!["docs/guide.md".to_string(), "README.md".to_string()]
        );
    }
}
