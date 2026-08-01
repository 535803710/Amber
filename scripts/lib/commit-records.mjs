import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { RETRY_DELAYS_MS, MAX_ATTEMPTS } from "./change-records.mjs";
import {
  claimOutboxItem,
  claimReadyOutboxItems,
  ensureOutboxDirs
} from "./file-outbox.mjs";

export const COMMIT_RECORD_DIR = ".local/commit-records";
const MAX_FILES = 200;

export function scanCommitRecords({ rootDir = process.cwd(), scanRoot, scanRoots } = {}) {
  const stateRoot = resolve(rootDir);
  const state = readJson(resolve(commitRoot(stateRoot), "scanner-state.json")) || { repositories: {} };
  const configuredRoots = resolveScanRoots({ scanRoot, scanRoots });
  const repositories = discoverRepositories(configuredRoots);
  const scanErrors = [];
  for (const repoPath of Object.keys(state.repositories || {})) {
    if (!configuredRoots.some((root) => isPathWithin(root, repoPath))) {
      delete state.repositories[repoPath];
    }
  }
  const found = [];
  for (const repoPath of repositories) {
    try {
      const refs = localRefs(repoPath);
      const previous = state.repositories[repoPath];
      if (!previous) {
        state.repositories[repoPath] = { refs, refsReadOk: true, initializedAt: new Date().toISOString() };
        continue;
      }
      if (previous.refsReadOk !== true && Object.keys(previous.refs || {}).length === 0) {
        state.repositories[repoPath] = {
          refs,
          refsReadOk: true,
          initializedAt: previous.initializedAt,
          updatedAt: new Date().toISOString()
        };
        continue;
      }
      for (const [ref, nextSha] of Object.entries(refs)) {
        const oldSha = previous.refs?.[ref] || "";
        if (!nextSha || nextSha === oldSha) continue;
        const commits = newCommits(repoPath, nextSha, oldSha, Object.values(previous.refs || {}));
        for (const sha of commits) {
          const event = buildCommitEvent(repoPath, sha, ref, oldSha ? "forward" : "new_ref", stateRoot);
          if (event && enqueueCommitEvent(event, { rootDir: stateRoot }).queued) found.push(event);
        }
      }
      state.repositories[repoPath] = { refs, refsReadOk: true, initializedAt: previous.initializedAt, updatedAt: new Date().toISOString() };
    } catch (error) {
      appendLog(stateRoot, `scan skipped ${repoPath}: ${error.message}`);
      scanErrors.push({ repository: repoPath, message: String(error.message || error).slice(0, 500) });
    }
  }
  writeJson(resolve(commitRoot(stateRoot), "scanner-state.json"), {
    ...state,
    scanRoots: configuredRoots,
    lastScanAt: new Date().toISOString(),
    repositoryCount: repositories.length,
    repositoryErrors: scanErrors,
    repositoryErrorsAt: scanErrors.length > 0 ? new Date().toISOString() : null
  });
  return { repositories: repositories.length, events: found, scanRoots: configuredRoots };
}

export function getCommitRecordStatus({ rootDir = process.cwd(), webhookUrl = process.env.FEISHU_COMMIT_WEBHOOK_URL } = {}) {
  const root = resolve(rootDir);
  const state = readJson(resolve(commitRoot(root), "worker-state.json")) || {};
  const scan = readJson(resolve(commitRoot(root), "scanner-state.json")) || {};
  const scanRoots = resolveScanRoots();
  return { configured: Boolean(webhookUrl), scanConfigured: scanRoots.length > 0, scanRoots, pending: listQueue(root, "pending").length, processing: listQueue(root, "processing").length, failed: listQueue(root, "failed").length, sent: listQueue(root, "sent").length, lastHeartbeatAt: state.lastHeartbeatAt || null, lastSuccessAt: state.lastSuccessAt || null, lastError: state.lastError || null, lastScanAt: scan.lastScanAt || null, repositoryCount: scan.repositoryCount || 0, repositoryErrors: scan.repositoryErrors || [] };
}

export function parseScanRoots(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseScanRoots(item));
  }
  if (typeof value !== "string") {
    return [];
  }
  return value.split(";").map((item) => item.trim()).filter(Boolean);
}

export function resolveScanRoots({ scanRoot, scanRoots, env = process.env } = {}) {
  const rawRoots = scanRoots !== undefined
    ? parseScanRoots(scanRoots)
    : scanRoot !== undefined
      ? parseScanRoots(scanRoot)
      : parseScanRoots(env.COMMIT_RECORD_SCAN_ROOTS);
  const roots = [];
  const seen = new Set();
  for (const item of rawRoots) {
    if (!isAbsolute(item) || !existsSync(item)) continue;
    const root = resolve(item);
    const key = process.platform === "win32" ? root.toLowerCase() : root;
    if (!isDirectory(root) || seen.has(key)) continue;
    seen.add(key);
    roots.push(root);
  }
  return roots;
}

export function enqueueCommitEvent(event, { rootDir = process.cwd() } = {}) {
  const root = resolve(rootDir); ensureQueues(root);
  const id = safeName(event.event_id);
  if (["pending", "processing", "sent", "failed"].some((name) => existsSync(queueFile(root, name, id)))) return { queued: false, duplicate: true };
  writeJson(queueFile(root, "pending", id), { event, attempts: 0, createdAt: new Date().toISOString(), nextAttemptAt: new Date().toISOString(), lastError: null });
  return { queued: true, duplicate: false };
}

export function findPendingCommitItem(eventId, { rootDir = process.cwd() } = {}) {
  const root = resolve(rootDir);
  return listQueue(root, "pending")
    .map((filePath) => ({ filePath, envelope: readJson(filePath) }))
    .find((item) => item.envelope?.event?.event_id === eventId) || null;
}

export function claimReadyCommitItems(options = {}) {
  const rootDir = resolve(options.rootDir || process.cwd());
  return claimReadyOutboxItems({
    queueRoot: queueRoot(rootDir),
    now: options.now || new Date(),
    limit: options.limit ?? Infinity,
    processingLeaseMs: options.processingLeaseMs,
    readEnvelope: readJson,
    writeEnvelope: writeJson
  });
}

export function claimPendingCommitItem(eventId, { rootDir = process.cwd() } = {}) {
  const root = resolve(rootDir);
  return claimOutboxItem({
    queueRoot: queueRoot(root),
    fileName: `${safeName(eventId)}.json`,
    readEnvelope: readJson,
    writeEnvelope: writeJson
  });
}

export function listPendingCommitItems({ rootDir = process.cwd() } = {}) {
  const root = resolve(rootDir); ensureQueues(root);
  return listQueue(root, "pending")
    .map((filePath) => ({ filePath, envelope: readJson(filePath) }))
    .filter((item) => item.envelope?.event?.event_id)
    .sort((left, right) => String(left.envelope.createdAt).localeCompare(String(right.envelope.createdAt)));
}

export function readyCommitItems({ rootDir = process.cwd(), now = new Date(), limit = Infinity } = {}) {
  const root = resolve(rootDir); ensureQueues(root);
  const items = [];
  for (const filePath of listQueue(root, "pending")) {
    const envelope = readJson(filePath);
    if (!envelope?.event?.event_id || new Date(envelope.nextAttemptAt || 0) > now) continue;
    items.push({ filePath, envelope });
    if (items.length >= limit) break;
  }
  return items;
}

export function markCommitSent(item, response, { rootDir = process.cwd() } = {}) {
  const root = resolve(rootDir); writeJson(queueFile(root, "sent", safeName(item.envelope.event.event_id)), { ...withoutClaim(item.envelope), sentAt: new Date().toISOString(), response: { statusCode: response.statusCode } }); remove(item.filePath);
}

export function markCommitFailed(item, error, { rootDir = process.cwd() } = {}) {
  const root = resolve(rootDir); const attempts = Number(item.envelope.attempts || 0) + 1;
  const next = { ...withoutClaim(item.envelope), attempts, lastError: String(error?.message || error).slice(0, 1000), lastAttemptAt: new Date().toISOString() };
  if (attempts >= MAX_ATTEMPTS) { writeJson(queueFile(root, "failed", safeName(item.envelope.event.event_id)), { ...next, failedAt: new Date().toISOString() }); remove(item.filePath); return { failedPermanently: true }; }
  next.nextAttemptAt = new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]).toISOString(); const pendingFile = queueFile(root, "pending", safeName(item.envelope.event.event_id)); writeJson(pendingFile, next); if (item.filePath !== pendingFile) remove(item.filePath); return { failedPermanently: false };
}

export function replayFailedCommitEvents({ rootDir = process.cwd() } = {}) { const root = resolve(rootDir); let replayed = 0; for (const filePath of listQueue(root, "failed")) { const item = readJson(filePath); if (!item?.event?.event_id) continue; writeJson(queueFile(root, "pending", safeName(item.event.event_id)), { ...item, attempts: 0, nextAttemptAt: new Date().toISOString(), lastError: null }); remove(filePath); replayed++; } return { replayed }; }
export function writeCommitWorkerState(patch, { rootDir = process.cwd() } = {}) { const file = resolve(commitRoot(resolve(rootDir)), "worker-state.json"); writeJson(file, { ...(readJson(file) || {}), ...patch }); }

function buildCommitEvent(repo, sha, ref, refUpdateType, rootDir) {
  const meta = git(repo, ["show", "-s", "--format=%H%x00%P%x00%aI%x00%an%x00%s%x00%B", sha]); if (!meta.ok) return null;
  const [commitSha, parentsLine, committedAt, authorName, subject, message] = meta.stdout.split("\0");
  const parents = parentsLine.trim() ? parentsLine.trim().split(" ") : [];
  const diffBase = parents[0] || `${sha}^0`;
  const diff = parents.length
    ? git(repo, ["-c", "core.quotepath=false", "diff", "--name-status", "--find-renames", parents[0], sha])
    : git(repo, ["-c", "core.quotepath=false", "show", "--format=", "--name-status", "--find-renames", sha]);
  const stats = parents.length
    ? git(repo, ["-c", "core.quotepath=false", "diff", "--numstat", parents[0], sha])
    : git(repo, ["-c", "core.quotepath=false", "show", "--format=", "--numstat", sha]);
  const changedFiles = parseNames(diff.stdout).slice(0, MAX_FILES); const totals = parseStats(stats.stdout);
  const event = { schema_version: 1, event_type: "git_commit", event_id: createHash("sha256").update(`${resolve(repo)}\0${commitSha.trim()}`).digest("hex"), detected_at: new Date().toISOString(), committed_at: committedAt.trim(), project: basename(repo), repo_path: resolve(repo), remote_url: sanitizeRemote(git(repo, ["remote", "get-url", "origin"]).stdout.trim()), branch: ref.replace("refs/heads/", ""), commit_sha: commitSha.trim(), short_sha: commitSha.trim().slice(0, 12), parent_shas: parents, commit_kind: parents.length > 1 ? "merge" : classifyCommit(subject, message), ref_update_type: refUpdateType, author_name: authorName.trim(), commit_subject: subject.trim(), commit_message: String(message || "").trim().slice(0, 2000), changed_files: changedFiles, changed_file_count: changedFiles.length, additions: totals.additions, deletions: totals.deletions };
  event.related_ai_event_ids = relatedAiEvents(rootDir, event); return event;
}
function relatedAiEvents(rootDir, event) { const cutoff = Date.now() - 7 * 86400000; const paths = new Set(event.changed_files.map((x) => x.path)); const dirs = ["sent", "pending", "failed"]; const ids = []; for (const dir of dirs) for (const file of listChangeQueue(rootDir, dir)) { const ai = readJson(file)?.event; if (ai?.repo_path === event.repo_path && new Date(ai.completed_at).getTime() >= cutoff && ai.changed_files?.some((x) => paths.has(x.path))) ids.push(ai.event_id); } return [...new Set(ids)].slice(0, 20); }
function discoverRepositories(roots) {
  const result = new Set();
  const visit = (dir, depth) => {
    if (depth > 5 || !existsSync(dir)) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((entry) => entry.name === ".git")) {
      result.add(resolve(dir));
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !["node_modules", ".git", "dist", "build", "vendor"].includes(entry.name)) {
        visit(resolve(dir, entry.name), depth + 1);
      }
    }
  };
  for (const root of roots) visit(root, 0);
  return [...result];
}
function isDirectory(path) { try { return statSync(path).isDirectory(); } catch { return false; } }
function isPathWithin(root, candidate) {
  const value = relative(resolve(root), resolve(candidate));
  return value === "" || (!isAbsolute(value) && !value.startsWith(`..${sep}`) && value !== "..");
}
function localRefs(repo) {
  const result = git(repo, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]);
  if (!result.ok) throw new Error("unable to read local Git refs");
  return Object.fromEntries(result.stdout.split(/\r?\n/).filter(Boolean).map((x) => x.split(" ")));
}
function newCommits(repo,next,old,known) { const args=["rev-list","--reverse",next]; if (old) args.push(`^${old}`); else for (const sha of known.filter(Boolean)) args.push(`^${sha}`); return git(repo,args).stdout.split(/\r?\n/).filter(Boolean); }
function parseNames(text) { return text.split(/\r?\n/).filter(Boolean).map((line)=>{const p=line.split("\t"), s=(p[0]||"M")[0]; return (s==="R"||s==="C")&&p.length>2?{status:s,old_path:p[1],path:p[2]}:{status:s,path:p[1]||p[0]};}); }
function parseStats(text) { let additions=0,deletions=0; for(const line of text.split(/\r?\n/)){const [a,d]=line.split("\t"); additions+=Number(a)||0; deletions+=Number(d)||0;} return {additions,deletions}; }
function classifyCommit(subject,message) { const text=`${subject}\n${message}`; if (/This reverts commit|^Revert /m.test(text)) return "revert"; if (/cherry picked from commit/i.test(text)) return "cherry_pick"; return "normal"; }
function sanitizeRemote(value) { try { const url=new URL(value); url.username=""; url.password=""; return url.toString(); } catch { return value.replace(/^[^@]+@/,""); } }
function git(repo,args){const result=spawnSync("git",["-C",repo,...args],{encoding:"utf8",windowsHide:true,maxBuffer:20*1024*1024});return {ok:result.status===0&&!result.error,stdout:String(result.stdout||"")};}
function commitRoot(root){return resolve(root,COMMIT_RECORD_DIR);} function queueRoot(root){return resolve(commitRoot(root),"queue");} function queueFile(root,name,id){return resolve(queueRoot(root),name,`${id}.json`);} function listQueue(root,name){const dir=resolve(queueRoot(root),name); return existsSync(dir)?readdirSync(dir,{withFileTypes:true}).filter(x=>x.isFile()&&x.name.endsWith(".json")).map(x=>resolve(dir,x.name)):[];} function listChangeQueue(root,name){const dir=resolve(root,".local/change-records/queue",name); return existsSync(dir)?readdirSync(dir,{withFileTypes:true}).filter(x=>x.isFile()&&x.name.endsWith(".json")).map(x=>resolve(dir,x.name)):[];} function ensureQueues(root){ensureOutboxDirs(queueRoot(root));} function safeName(s){return String(s).replace(/[^A-Za-z0-9._-]/g,"-");} function readJson(file){try{return JSON.parse(readFileSync(file,"utf8"));}catch{return null;}} function writeJson(file,value){mkdirSync(dirname(file),{recursive:true});const temp=`${file}.${process.pid}.${Date.now()}.tmp`;writeFileSync(temp,JSON.stringify(value,null,2)+"\n","utf8");renameSync(temp,file);} function withoutClaim(envelope){const result={...envelope}; delete result.claimedAt; return result;} function remove(file){try{unlinkSync(file);}catch(error){if(error.code!=="ENOENT")throw error;}} function appendLog(root,message){const file=resolve(commitRoot(root),"commit-records.log");mkdirSync(dirname(file),{recursive:true});writeFileSync(file,`[${new Date().toISOString()}] ${message}\n`,{encoding:"utf8",flag:"a"});}
