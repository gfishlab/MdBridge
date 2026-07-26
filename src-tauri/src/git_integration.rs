use serde::Serialize;
use std::path::{Component, Path, PathBuf};
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
pub struct GitChangedFile {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitRemote {
    pub name: String,
    pub url: String,
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

pub fn parse_changed_files_output(output: &str) -> Vec<GitChangedFile> {
    output
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }

            let status = line[..2].trim().to_string();
            let path = decode_git_status_path(line[3..].trim());
            if status.is_empty() || path.is_empty() {
                return None;
            }

            let staged = line
                .as_bytes()
                .first()
                .is_some_and(|value| !value.is_ascii_whitespace() && *value != b'?');

            Some(GitChangedFile {
                path,
                status,
                staged,
            })
        })
        .collect()
}

pub fn parse_remote_output(output: &str) -> Vec<GitRemote> {
    let mut remotes = Vec::new();

    for line in output.lines() {
        let mut parts = line.split_whitespace();
        let Some(name) = parts.next() else {
            continue;
        };
        let Some(url) = parts.next() else {
            continue;
        };
        let kind = parts.next().unwrap_or_default();
        if kind != "(fetch)" {
            continue;
        }
        if remotes.iter().any(|remote: &GitRemote| remote.name == name) {
            continue;
        }
        remotes.push(GitRemote {
            name: name.into(),
            url: url.into(),
        });
    }

    remotes
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

fn decode_git_status_path(raw_path: &str) -> String {
    let path = raw_path
        .rsplit_once(" -> ")
        .map(|(_, next_path)| next_path)
        .unwrap_or(raw_path)
        .trim();

    decode_git_quoted_path(path)
}

fn decode_git_quoted_path(path: &str) -> String {
    let trimmed = path.trim();
    let quoted = trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2;
    let content = if quoted {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    };

    if !content.contains('\\') {
        return content.to_string();
    }

    let mut bytes = Vec::new();
    let mut chars = content.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            let mut buffer = [0; 4];
            bytes.extend_from_slice(ch.encode_utf8(&mut buffer).as_bytes());
            continue;
        }

        let Some(escaped) = chars.next() else {
            bytes.push(b'\\');
            break;
        };

        if escaped.is_ascii_digit() && escaped < '8' {
            let mut octal = String::from(escaped);
            for _ in 0..2 {
                if let Some(next) = chars.peek().copied() {
                    if next.is_ascii_digit() && next < '8' {
                        octal.push(next);
                        chars.next();
                    }
                }
            }
            if let Ok(value) = u8::from_str_radix(&octal, 8) {
                bytes.push(value);
            }
            continue;
        }

        let decoded = match escaped {
            'a' => '\u{0007}',
            'b' => '\u{0008}',
            'f' => '\u{000c}',
            'n' => '\n',
            'r' => '\r',
            't' => '\t',
            'v' => '\u{000b}',
            '\\' => '\\',
            '"' => '"',
            other => other,
        };
        let mut buffer = [0; 4];
        bytes.extend_from_slice(decoded.encode_utf8(&mut buffer).as_bytes());
    }

    String::from_utf8(bytes).unwrap_or_else(|_| content.to_string())
}

pub fn get_status(path: &str) -> Result<GitStatus, String> {
    let repo_root = repo_root_for_path(path)?;
    let output = run_git(
        &repo_root,
        &[
            "-c",
            "core.quotepath=false",
            "status",
            "--porcelain=v1",
            "--branch",
        ],
    )?;
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

pub fn get_changed_files(path: &str) -> Result<Vec<GitChangedFile>, String> {
    let repo_root = repo_root_for_path(path)?;
    let output = run_git(
        &repo_root,
        &["-c", "core.quotepath=false", "status", "--porcelain=v1"],
    )?;
    Ok(parse_changed_files_output(&output))
}

pub fn get_remotes(path: &str) -> Result<Vec<GitRemote>, String> {
    let repo_root = repo_root_for_path(path)?;
    let output = run_git(&repo_root, &["remote", "-v"])?;
    Ok(parse_remote_output(&output))
}

pub fn add_remote(
    path: &str,
    name: &str,
    domain: &str,
    branch_name: &str,
    url: &str,
) -> Result<GitOperationResult, String> {
    let name = validate_remote_name(name)?;
    let branch_name = branch_name.trim();
    let url = url.trim();
    if url.is_empty() {
        return Err("Remote 地址不能为空".into());
    }
    if domain.trim().is_empty() {
        return Err("域名不能为空".into());
    }

    let repo_root = repo_root_for_path(path)?;
    let mut command = git_command(&repo_root);
    command.arg("remote").arg("add");
    if !branch_name.is_empty() {
        command.arg("-t").arg(validate_branch_name(branch_name)?);
    }
    command.arg(name).arg(url);
    run_prepared_git(command)?;

    Ok(GitOperationResult {
        message: format!("已添加 remote {}", name),
    })
}

pub fn remove_remote(path: &str, name: &str) -> Result<GitOperationResult, String> {
    let name = validate_remote_name(name)?;
    let repo_root = repo_root_for_path(path)?;
    let mut command = git_command(&repo_root);
    command.arg("remote").arg("remove").arg(name);
    run_prepared_git(command)?;

    Ok(GitOperationResult {
        message: format!("已删除 remote {}", name),
    })
}

pub fn checkout_branch(path: &str, branch: &str, kind: &str) -> Result<GitOperationResult, String> {
    let branch = validate_branch_name(branch)?;
    let repo_root = repo_root_for_path(path)?;
    let target = if kind == "remote" {
        let local_name = local_name_for_remote_branch(branch)?;
        if local_branch_exists(&repo_root, local_name) {
            local_name
        } else {
            let mut command = git_command(&repo_root);
            command.arg("checkout").arg("--track").arg(branch);
            run_prepared_git(command)?;
            return Ok(GitOperationResult {
                message: format!("已切换到远程跟踪分支 {}", branch),
            });
        }
    } else {
        branch
    };

    let mut command = git_command(&repo_root);
    command.arg("checkout").arg(target);
    run_prepared_git(command)?;

    Ok(GitOperationResult {
        message: format!("已切换到分支 {}", target),
    })
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

pub fn get_worktree_file_diff(path: &str, file_path: &str) -> Result<String, String> {
    let repo_root = repo_root_for_path(path)?;
    let relative_path = validate_relative_repo_path(file_path)?;

    if !is_tracked_in_head(&repo_root, &relative_path) {
        return format_added_file_diff_from_disk(&repo_root, &relative_path);
    }

    let mut chunks = Vec::new();
    let mut cached = git_command(&repo_root);
    cached
        .arg("diff")
        .arg("--cached")
        .arg("--find-renames")
        .arg("--no-ext-diff")
        .arg("--")
        .arg(&relative_path);
    let cached_output = run_prepared_git(cached)?;
    if !cached_output.trim().is_empty() {
        chunks.push(cached_output);
    }

    let mut worktree = git_command(&repo_root);
    worktree
        .arg("diff")
        .arg("--find-renames")
        .arg("--no-ext-diff")
        .arg("--")
        .arg(&relative_path);
    let worktree_output = run_prepared_git(worktree)?;
    if !worktree_output.trim().is_empty() {
        chunks.push(worktree_output);
    }

    Ok(if chunks.is_empty() {
        "该文件没有可显示的改动。".into()
    } else {
        chunks.join("\n")
    })
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

pub fn commit_files(
    path: &str,
    file_paths: &[String],
    message: &str,
) -> Result<GitOperationResult, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("提交信息不能为空".into());
    }
    if file_paths.is_empty() {
        return Err("至少选择一个文件".into());
    }

    let repo_root = repo_root_for_path(path)?;
    let relative_paths = file_paths
        .iter()
        .map(|file_path| validate_relative_repo_path(file_path))
        .collect::<Result<Vec<_>, _>>()?;

    let mut add = git_command(&repo_root);
    add.arg("add").arg("--").args(&relative_paths);
    run_prepared_git(add)?;

    let mut commit = git_command(&repo_root);
    commit
        .arg("commit")
        .arg("-m")
        .arg(message)
        .arg("--")
        .args(&relative_paths);
    let output = run_prepared_git(commit)?;

    Ok(GitOperationResult {
        message: output.trim().into(),
    })
}

pub fn fetch_repository(path: &str) -> Result<GitOperationResult, String> {
    let repo_root = repo_root_for_path(path)?;
    let output = run_git(&repo_root, &["fetch", "--all", "--prune"])?;
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

pub fn rollback_changed_file(path: &str, file_path: &str) -> Result<GitOperationResult, String> {
    let repo_root = repo_root_for_path(path)?;
    let relative_path = validate_relative_repo_path(file_path)?;
    let status = changed_file_status(&repo_root, &relative_path)?;
    if status.trim().is_empty() {
        return Err("该文件没有可回滚的改动".into());
    }

    if is_tracked_in_head(&repo_root, &relative_path) {
        let mut restore = git_command(&repo_root);
        restore
            .arg("restore")
            .arg("--staged")
            .arg("--worktree")
            .arg("--")
            .arg(&relative_path);
        run_prepared_git(restore)?;
    } else {
        let mut unstage = git_command(&repo_root);
        unstage
            .arg("restore")
            .arg("--staged")
            .arg("--")
            .arg(&relative_path);
        let _ = run_prepared_git(unstage);

        let target = repo_root.join(relative_path.split('/').collect::<PathBuf>());
        if target.is_dir() {
            return Err("不能直接回滚未跟踪目录，请在文件树中删除目录".into());
        }
        if target.exists() {
            std::fs::remove_file(&target).map_err(|e| format!("删除新增文件失败: {}", e))?;
        }
    }

    Ok(GitOperationResult {
        message: format!("已回滚 {} 的改动", relative_path),
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

fn validate_branch_name(branch: &str) -> Result<&str, String> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("分支名不能为空".into());
    }
    if branch.starts_with('-')
        || branch.ends_with('/')
        || branch.contains("..")
        || branch.contains("@{")
        || branch.contains('\\')
        || branch
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, ' ' | '~' | '^' | ':' | '?' | '*' | '['))
    {
        return Err("非法分支名".into());
    }
    Ok(branch)
}

fn validate_remote_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Remote 名称不能为空".into());
    }
    if name.starts_with('-')
        || name.contains(' ')
        || name.contains('\\')
        || name.contains("..")
        || name.contains('@')
        || name.contains('{')
        || name.contains('}')
        || name.contains(':')
    {
        return Err("Remote 名称不合法".into());
    }
    Ok(name)
}

fn validate_relative_repo_path(file_path: &str) -> Result<String, String> {
    let file_path = file_path.trim();
    if file_path.is_empty() {
        return Err("文件路径不能为空".into());
    }
    if file_path.contains('\\') {
        return Err("文件路径必须使用仓库相对路径".into());
    }

    let path = Path::new(file_path);
    if path.is_absolute() {
        return Err("文件路径必须是仓库相对路径".into());
    }

    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            Component::CurDir => {}
            _ => return Err("文件路径不能跳出仓库".into()),
        }
    }

    if parts.is_empty() {
        return Err("文件路径不能为空".into());
    }

    Ok(parts.join("/"))
}

fn local_name_for_remote_branch(branch: &str) -> Result<&str, String> {
    let (_, local_name) = branch
        .split_once('/')
        .ok_or_else(|| "远程分支名必须包含远程仓库名".to_string())?;
    if local_name.is_empty() || local_name == "HEAD" {
        return Err("不能直接切换该远程分支".into());
    }
    Ok(local_name)
}

fn local_branch_exists(repo_root: &Path, branch: &str) -> bool {
    let mut command = git_command(repo_root);
    command.arg("show-ref").arg("--verify").arg("--quiet");
    command.arg(format!("refs/heads/{}", branch));
    command.output().is_ok_and(|output| output.status.success())
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

fn changed_file_status(repo_root: &Path, relative_path: &str) -> Result<String, String> {
    let mut command = git_command(repo_root);
    command
        .arg("status")
        .arg("--porcelain=v1")
        .arg("--")
        .arg(relative_path);
    let output = run_prepared_git(command)?;
    Ok(output
        .lines()
        .next()
        .and_then(|line| line.get(..2))
        .unwrap_or_default()
        .trim()
        .to_string())
}

fn is_tracked_in_head(repo_root: &Path, relative_path: &str) -> bool {
    let mut command = git_command(repo_root);
    command
        .arg("cat-file")
        .arg("-e")
        .arg(format!("HEAD:{}", relative_path));
    command.output().is_ok_and(|output| output.status.success())
}

fn format_added_file_diff_from_disk(
    repo_root: &Path,
    relative_path: &str,
) -> Result<String, String> {
    let target = repo_root.join(relative_path.split('/').collect::<PathBuf>());
    if target.is_dir() {
        return Ok(format!(
            "diff --git a/{0} b/{0}\n新增目录暂不展示内容。\n",
            relative_path
        ));
    }

    let content =
        std::fs::read_to_string(&target).map_err(|e| format!("读取新增文件失败: {}", e))?;
    Ok(format_added_file_diff(relative_path, &content))
}

fn format_added_file_diff(relative_path: &str, content: &str) -> String {
    let line_count = content.lines().count();
    let mut diff = format!(
        "diff --git a/{0} b/{0}\nnew file mode 100644\n--- /dev/null\n+++ b/{0}\n@@ -0,0 +1,{1} @@\n",
        relative_path, line_count
    );
    for line in content.lines() {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }
    diff
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
        format_added_file_diff, parse_branch_output, parse_changed_files_output,
        parse_conflict_file_output, parse_graph_line, parse_log_line, parse_recent_branch_output,
        parse_remote_output, parse_status_output, validate_branch_name,
        validate_relative_repo_path, validate_remote_name, GitBranch, GitChangedFile, GitCommit,
        GitCommitGraphEntry, GitRemote, GitStatus,
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
    fn parses_changed_files_with_stage_status() {
        let files =
            parse_changed_files_output(" M docs/guide.md\nA  README.md\n?? draft.md\nD  old.md\n");

        assert_eq!(
            files,
            vec![
                GitChangedFile {
                    path: "docs/guide.md".into(),
                    status: "M".into(),
                    staged: false,
                },
                GitChangedFile {
                    path: "README.md".into(),
                    status: "A".into(),
                    staged: true,
                },
                GitChangedFile {
                    path: "draft.md".into(),
                    status: "??".into(),
                    staged: false,
                },
                GitChangedFile {
                    path: "old.md".into(),
                    status: "D".into(),
                    staged: true,
                },
            ]
        );
    }

    #[test]
    fn parses_quoted_non_ascii_changed_file_paths() {
        let files = parse_changed_files_output(
            r#"?? "\345\256\236\346\265\213.md"
 M "notes/\346\226\207\346\241\243.md"
"#,
        );

        assert_eq!(
            files,
            vec![
                GitChangedFile {
                    path: "实测.md".into(),
                    status: "??".into(),
                    staged: false,
                },
                GitChangedFile {
                    path: "notes/文档.md".into(),
                    status: "M".into(),
                    staged: false,
                },
            ]
        );
    }

    #[test]
    fn parses_fetch_remotes_without_push_duplicates() {
        let remotes = parse_remote_output(
            "origin\tgit@github.com:gfishlab/MdBridge.git (fetch)\norigin\tgit@github.com:gfishlab/MdBridge.git (push)\nupstream\thttps://github.com/example/upstream.git (fetch)\n",
        );

        assert_eq!(
            remotes,
            vec![
                GitRemote {
                    name: "origin".into(),
                    url: "git@github.com:gfishlab/MdBridge.git".into(),
                },
                GitRemote {
                    name: "upstream".into(),
                    url: "https://github.com/example/upstream.git".into(),
                },
            ]
        );
    }

    #[test]
    fn validates_remote_names() {
        assert_eq!(validate_remote_name("origin"), Ok("origin"));
        assert_eq!(validate_remote_name("team-mirror"), Ok("team-mirror"));
        assert!(validate_remote_name("").is_err());
        assert!(validate_remote_name("-origin").is_err());
        assert!(validate_remote_name("bad name").is_err());
        assert!(validate_remote_name("bad..name").is_err());
    }

    #[test]
    fn validates_branch_names_for_checkout() {
        assert_eq!(
            validate_branch_name("feature/docs-v2"),
            Ok("feature/docs-v2")
        );
        assert!(validate_branch_name("-danger").is_err());
        assert!(validate_branch_name("bad branch").is_err());
        assert!(validate_branch_name("bad..branch").is_err());
        assert!(validate_branch_name("bad@{branch").is_err());
    }

    #[test]
    fn validates_changed_file_paths_stay_inside_repo() {
        assert_eq!(
            validate_relative_repo_path("./docs/guide.md"),
            Ok("docs/guide.md".into())
        );
        assert!(validate_relative_repo_path("../secret.md").is_err());
        assert!(validate_relative_repo_path("/tmp/secret.md").is_err());
        assert!(validate_relative_repo_path("docs\\guide.md").is_err());
        assert!(validate_relative_repo_path("").is_err());
    }

    #[test]
    fn formats_added_text_file_as_diff() {
        let diff = format_added_file_diff("docs/draft.md", "# Draft\nhello\n");

        assert!(diff.contains("diff --git a/docs/draft.md b/docs/draft.md"));
        assert!(diff.contains("--- /dev/null"));
        assert!(diff.contains("+++ b/docs/draft.md"));
        assert!(diff.contains("+# Draft"));
        assert!(diff.contains("+hello"));
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
