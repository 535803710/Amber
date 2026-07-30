#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { assertWebhookSuccess, postJson } from "./change-record-worker.mjs";
import { getCommitRecordStatus, markCommitFailed, markCommitSent, readyCommitItems, replayFailedCommitEvents, scanCommitRecords, writeCommitWorkerState } from "./lib/commit-records.mjs";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),".."); const INTERVAL=5000;
loadEnv(".env"); loadEnv(".env.local");
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch((e)=>{console.error(e.message);process.exitCode=1;});
async function main(){const args=process.argv.slice(2);if(args.includes("--status")){console.log(JSON.stringify(getCommitRecordStatus({rootDir:ROOT}),null,2));return;}if(args.includes("--replay-failed")){console.log(JSON.stringify(replayFailedCommitEvents({rootDir:ROOT}),null,2));return;}const once=args.includes("--once"),dry=args.includes("--dry-run");do{scanCommitRecords({rootDir:ROOT});await deliver(dry);if(!once)await new Promise(r=>setTimeout(r,INTERVAL));}while(!once);}
export async function deliver(dryRun=false,{rootDir=ROOT,webhookUrl=process.env.FEISHU_COMMIT_WEBHOOK_URL||"",webhookToken=process.env.FEISHU_COMMIT_WEBHOOK_TOKEN||""}={}){for(const item of readyCommitItems({rootDir})){if(dryRun){console.log(JSON.stringify(item.envelope.event,null,2));continue;}if(!webhookUrl)return;try{const response=await postJson(webhookUrl,item.envelope.event,webhookToken);assertWebhookSuccess(response);markCommitSent(item,response,{rootDir});writeCommitWorkerState({lastSuccessAt:new Date().toISOString(),lastError:null},{rootDir});}catch(error){markCommitFailed(item,error,{rootDir});writeCommitWorkerState({lastError:error.message,lastErrorAt:new Date().toISOString()},{rootDir});}}}
function loadEnv(name){const file=resolve(ROOT,name);if(!existsSync(file))return;for(const line of readFileSync(file,"utf8").split(/\r?\n/)){const i=line.indexOf("=");if(i>0&&!line.trim().startsWith("#")){const k=line.slice(0,i).trim();if(process.env[k]===undefined)process.env[k]=line.slice(i+1).trim().replace(/^['\"]|['\"]$/g,"");}}}
