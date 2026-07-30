import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { RETRY_DELAYS_MS, MAX_ATTEMPTS } from "./change-records.mjs";

export const COMMIT_RECORD_DIR = ".local/commit-records";
const MAX_FILES = 200;

export function scanCommitRecords({ rootDir = process.cwd(), scanRoot = "D:/project" } = {}) {
  const stateRoot = resolve(rootDir);
  const state = readJson(resolve(commitRoot(stateRoot), "scanner-state.json")) || { repositories: {} };
  const repositories = discoverRepositories(scanRoot);
  const found = [];
  for (const repoPath of repositories) {
    try {
      const refs = localRefs(repoPath);
      const previous = state.repositories[repoPath];
      if (!previous) {
        state.repositories[repoPath] = { refs, initializedAt: new Date().toISOString() };
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
      state.repositories[repoPath] = { refs, initializedAt: previous.initializedAt, updatedAt: new Date().toISOString() };
    } catch (error) {
      appendLog(stateRoot, `scan skipped ${repoPath}: ${error.message}`);
    }
  }
  writeJson(resolve(commitRoot(stateRoot), "scanner-state.json"), { ...state, lastScanAt: new Date().toISOString(), repositoryCount: repositories.length });
  return { repositories: repositories.length, events: found };
}

export function getCommitRecordStatus({ rootDir = process.cwd(), webhookUrl = process.env.FEISHU_COMMIT_WEBHOOK_URL } = {}) {
  const root = resolve(rootDir);
  const state = readJson(resolve(commitRoot(root), "worker-state.json")) || {};
  const scan = readJson(resolve(commitRoot(root), "scanner-state.json")) || {};
  return { configured: Boolean(webhookUrl), pending: listQueue(root, "pending").length, failed: listQueue(root, "failed").length, sent: listQueue(root, "sent").length, lastSuccessAt: state.lastSuccessAt || null, lastError: state.lastError || null, lastScanAt: scan.lastScanAt || null, repositoryCount: scan.repositoryCount || 0 };
}

export function enqueueCommitEvent(event, { rootDir = process.cwd() } = {}) {
  const root = resolve(rootDir); ensureQueues(root);
  const id = safeName(event.event_id);
  if (["pending", "sent", "failed"].some((name) => existsSync(queueFile(root, name, id)))) return { queued: false, duplicate: true };
  writeJson(queueFile(root, "pending", id), { event, attempts: 0, createdAt: new Date().toISOString(), nextAttemptAt: new Date().toISOString(), lastError: null });
  return { queued: true, duplicate: false };
}

export function readyCommitItems({ rootDir = process.cwd(), now = new Date() } = {}) {
  const root = resolve(rootDir); ensureQueues(root);
  return listQueue(root, "pending").map((filePath) => ({ filePath, envelope: readJson(filePath) })).filter((item) => item.envelope?.event?.event_id && new Date(item.envelope.nextAttemptAt || 0) <= now);
}

export function markCommitSent(item, response, { rootDir = process.cwd() } = {}) {
  const root = resolve(rootDir); writeJson(queueFile(root, "sent", safeName(item.envelope.event.event_id)), { ...item.envelope, sentAt: new Date().toISOString(), response: { statusCode: response.statusCode } }); remove(item.filePath);
}

export function markCommitFailed(item, error, { rootDir = process.cwd() } = {}) {
  const root = resolve(rootDir); const attempts = Number(item.envelope.attempts || 0) + 1;
  const next = { ...item.envelope, attempts, lastError: String(error?.message || error).slice(0, 1000), lastAttemptAt: new Date().toISOString() };
  if (attempts >= MAX_ATTEMPTS) { writeJson(queueFile(root, "failed", safeName(item.envelope.event.event_id)), { ...next, failedAt: new Date().toISOString() }); remove(item.filePath); return { failedPermanently: true }; }
  next.nextAttemptAt = new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]).toISOString(); writeJson(item.filePath, next); return { failedPermanently: false };
}

export function replayFailedCommitEvents({ rootDir = process.cwd() } = {}) { const root = resolve(rootDir); let replayed = 0; for (const filePath of listQueue(root, "failed")) { const item = readJson(filePath); if (!item?.event?.event_id) continue; writeJson(queueFile(root, "pending", safeName(item.event.event_id)), { ...item, attempts: 0, nextAttemptAt: new Date().toISOString(), lastError: null }); remove(filePath); replayed++; } return { replayed }; }
export function writeCommitWorkerState(patch, { rootDir = process.cwd() } = {}) { const file = resolve(commitRoot(resolve(rootDir)), "worker-state.json"); writeJson(file, { ...(readJson(file) || {}), ...patch }); }

function buildCommitEvent(repo, sha, ref, refUpdateType, rootDir) {
  const meta = git(repo, ["show", "-s", "--format=%H%x00%P%x00%aI%x00%an%x00%s%x00%B", sha]); if (!meta.ok) return null;
  const [commitSha, parentsLine, committedAt, authorName, subject, message] = meta.stdout.split("\0");
  const parents = parentsLine.trim() ? parentsLine.trim().split(" ") : [];
  const diffBase = parents[0] || `${sha}^0`;
  const diff = parents.length ? git(repo, ["diff", "--name-status", "--find-renames", parents[0], sha]) : git(repo, ["show", "--format=", "--name-status", "--find-renames", sha]);
  const stats = parents.length ? git(repo, ["diff", "--numstat", parents[0], sha]) : git(repo, ["show", "--format=", "--numstat", sha]);
  const changedFiles = parseNames(diff.stdout).slice(0, MAX_FILES); const totals = parseStats(stats.stdout);
  const event = { schema_version: 1, event_type: "git_commit", event_id: createHash("sha256").update(`${resolve(repo)}\0${commitSha.trim()}`).digest("hex"), detected_at: new Date().toISOString(), committed_at: committedAt.trim(), project: basename(repo), repo_path: resolve(repo), remote_url: sanitizeRemote(git(repo, ["remote", "get-url", "origin"]).stdout.trim()), branch: ref.replace("refs/heads/", ""), commit_sha: commitSha.trim(), short_sha: commitSha.trim().slice(0, 12), parent_shas: parents, commit_kind: parents.length > 1 ? "merge" : classifyCommit(subject, message), ref_update_type: refUpdateType, author_name: authorName.trim(), commit_subject: subject.trim(), commit_message: String(message || "").trim().slice(0, 2000), changed_files: changedFiles, changed_file_count: changedFiles.length, additions: totals.additions, deletions: totals.deletions };
  event.related_ai_event_ids = relatedAiEvents(rootDir, event); return event;
}
function relatedAiEvents(rootDir, event) { const cutoff = Date.now() - 7 * 86400000; const paths = new Set(event.changed_files.map((x) => x.path)); const dirs = ["sent", "pending", "failed"]; const ids = []; for (const dir of dirs) for (const file of listChangeQueue(rootDir, dir)) { const ai = readJson(file)?.event; if (ai?.repo_path === event.repo_path && new Date(ai.completed_at).getTime() >= cutoff && ai.changed_files?.some((x) => paths.has(x.path))) ids.push(ai.event_id); } return [...new Set(ids)].slice(0, 20); }
function discoverRepositories(root) { const result = []; const visit = (dir, depth) => { if (depth > 5 || !existsSync(dir)) return; let entries=[]; try { entries=readdirSync(dir,{withFileTypes:true}); } catch { return; } if (entries.some((x)=>x.name===".git")) { result.push(resolve(dir)); return; } for (const entry of entries) if (entry.isDirectory() && !["node_modules",".git","dist","build","vendor"].includes(entry.name)) visit(resolve(dir,entry.name),depth+1); }; visit(resolve(root),0); return result; }
function localRefs(repo) { const out=git(repo,["for-each-ref","--format=%(refname) %(objectname)","refs/heads"]).stdout; return Object.fromEntries(out.split(/\r?\n/).filter(Boolean).map((x)=>x.split(" "))); }
function newCommits(repo,next,old,known) { const args=["rev-list","--reverse",next]; if (old) args.push(`^${old}`); else for (const sha of known.filter(Boolean)) args.push(`^${sha}`); return git(repo,args).stdout.split(/\r?\n/).filter(Boolean); }
function parseNames(text) { return text.split(/\r?\n/).filter(Boolean).map((line)=>{const p=line.split("\t"), s=(p[0]||"M")[0]; return (s==="R"||s==="C")&&p.length>2?{status:s,old_path:p[1],path:p[2]}:{status:s,path:p[1]||p[0]};}); }
function parseStats(text) { let additions=0,deletions=0; for(const line of text.split(/\r?\n/)){const [a,d]=line.split("\t"); additions+=Number(a)||0; deletions+=Number(d)||0;} return {additions,deletions}; }
function classifyCommit(subject,message) { const text=`${subject}\n${message}`; if (/This reverts commit|^Revert /m.test(text)) return "revert"; if (/cherry picked from commit/i.test(text)) return "cherry_pick"; return "normal"; }
function sanitizeRemote(value) { try { const url=new URL(value); url.username=""; url.password=""; return url.toString(); } catch { return value.replace(/^[^@]+@/,""); } }
function git(repo,args){const result=spawnSync("git",["-C",repo,...args],{encoding:"utf8",windowsHide:true,maxBuffer:20*1024*1024});return {ok:result.status===0&&!result.error,stdout:String(result.stdout||"")};}
function commitRoot(root){return resolve(root,COMMIT_RECORD_DIR);} function queueFile(root,name,id){return resolve(commitRoot(root),"queue",name,`${id}.json`);} function listQueue(root,name){const dir=resolve(commitRoot(root),"queue",name); return existsSync(dir)?readdirSync(dir,{withFileTypes:true}).filter(x=>x.isFile()&&x.name.endsWith(".json")).map(x=>resolve(dir,x.name)):[];} function listChangeQueue(root,name){const dir=resolve(root,".local/change-records/queue",name); return existsSync(dir)?readdirSync(dir,{withFileTypes:true}).filter(x=>x.isFile()&&x.name.endsWith(".json")).map(x=>resolve(dir,x.name)):[];} function ensureQueues(root){for(const n of ["pending","sent","failed"]) mkdirSync(resolve(commitRoot(root),"queue",n),{recursive:true});} function safeName(s){return String(s).replace(/[^A-Za-z0-9._-]/g,"-");} function readJson(file){try{return JSON.parse(readFileSync(file,"utf8"));}catch{return null;}} function writeJson(file,value){mkdirSync(dirname(file),{recursive:true});const temp=`${file}.${process.pid}.tmp`;writeFileSync(temp,JSON.stringify(value,null,2)+"\n","utf8");renameSync(temp,file);} function remove(file){try{unlinkSync(file);}catch(error){if(error.code!=="ENOENT")throw error;}} function appendLog(root,message){const file=resolve(commitRoot(root),"commit-records.log");mkdirSync(dirname(file),{recursive:true});writeFileSync(file,`[${new Date().toISOString()}] ${message}\n`,{encoding:"utf8",flag:"a"});}
