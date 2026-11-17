/* Harris Livescore — integrated competitions, groups, standings and push alerts */
const SUPABASE_URL = "https://qhqlvknmkpiwgvjbyetp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Nx-gEll1DYYydixyCjQ80Q_JG5YUGQt";
const VAPID_PUBLIC_KEY = "BLgd9LoQJd7JBYbY9qKi9xj0MGjXe8sYOFjRqcvZ3HToN5XEz2ffygO4GIyiRa0ItwiPruFOkRrJo-P4vSPgkwg";
const db = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sports = ["Football","Basketball","Volleyball","Handball","Athletics"];
const icons = {Football:"⚽",Basketball:"🏀",Volleyball:"🏐",Handball:"🤾",Athletics:"🏃"};
let matches = [], competitions = [], teams = [], groups = [], stages = [], schools = [], entries = [];
let sportFilter = "all";
const fmtDate = value => { const d = new Date(value); return isNaN(d) ? "Date TBC" : d.toLocaleString([], {dateStyle:"medium",timeStyle:"short"}); };
const say = (id, message, isError=false) => { const el=$(id); if(el){el.textContent=message;el.classList.toggle("error",isError);} };
const formObject = form => Object.fromEntries(new FormData(form).entries());

function voterToken(){
  let token = localStorage.getItem("harris_voter_token");
  if(!token){token=crypto.randomUUID();localStorage.setItem("harris_voter_token",token);}
  return token;
}
function urlBase64ToUint8Array(value){
  const padding="=".repeat((4-value.length%4)%4);
  const raw=atob((value+padding).replace(/-/g,"+").replace(/_/g,"/"));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function enableMatchAlerts(matchId, button){
  const original=button.textContent;
  try{
    if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window)) throw new Error("This browser does not support push notifications.");
    if(!VAPID_PUBLIC_KEY) throw new Error("The VAPID public key is missing.");
    const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone=window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
    if(isIOS&&!standalone) throw new Error("On iPhone, add Harris Livescore to your Home Screen and open it from there.");
    const permission=await Notification.requestPermission();
    if(permission!=="granted") throw new Error("Please allow notifications in your browser settings.");
    button.disabled=true;button.textContent="Enabling alerts…";
    const registration=await navigator.serviceWorker.register("/sw.js");
    const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY)});
    const {data,error}=await db.functions.invoke("save-match-subscription",{body:{match_id:matchId,subscription:subscription.toJSON()}});
    if(error)throw error;
    button.textContent="🔔 Alerts Enabled";
    alert(data?.message||"Match alerts enabled.");
  }catch(error){console.error(error);button.textContent=original;alert(error.message||"Could not enable alerts.");}
  finally{button.disabled=false;}
}
async function sendMatchNotification(match,eventType,message,eventKey){
  if(!db||!match?.id)return;
  const {data,error}=await db.functions.invoke("send-match-notification",{body:{match_id:match.id,event_key:eventKey,event_type:eventType,message}});
  if(error){console.error("Notification request failed",error);alert("Match saved, but notification request failed. Check your admin session and Edge Function.");return;}
  if(data?.error&&data.error!=="This notification was already sent."){console.error(data.error);alert("Match saved, but notification failed: "+data.error);}
}

function matchCard(m){
  const status=m.status||"upcoming";
  const future=m.kickoff&&new Date(m.kickoff)>new Date();
  const alertButton=status==="upcoming"&&future?`<button class="alert-button" type="button" data-alert="${esc(m.id)}">🔔 Get Match Alerts</button>`:"";
  const poll=status==="upcoming"&&future?`<div class="fan-poll"><b>Who will win?</b><div class="poll-buttons"><button data-vote="home" data-match="${esc(m.id)}">${esc(m.home)}</button><button data-vote="draw" data-match="${esc(m.id)}">Draw</button><button data-vote="away" data-match="${esc(m.id)}">${esc(m.away)}</button></div><div class="poll-results" id="poll-${esc(m.id)}">Loading votes…</div><small>One vote per browser. Voting closes at kick-off.</small></div>`:"";
  const comp=m.competition||"Friendly";
  const score=status==="upcoming"?"—":`${Number(m.home_score)||0} – ${Number(m.away_score)||0}`;
  const elapsed=m.status==="live"&&m.timer_started_at?` · ${Math.max(0,Math.floor((Date.now()-new Date(m.timer_started_at).getTime())/60000))}'`:"";
  return `<article class="match-card"><div class="match-meta"><span>${icons[m.sport]||"🏅"} ${esc(m.sport||"Sport")} · ${esc(comp)}</span><span class="status ${esc(status)}">${status==="finished"?"FULL TIME":status==="live"?"● LIVE":esc(status.toUpperCase())}</span></div><div class="teams"><span>${esc(m.home)}</span><strong class="score">${score}</strong><span>${esc(m.away)}</span><span class="score"></span></div><div class="venue">${fmtDate(m.kickoff)}${m.venue?" · "+esc(m.venue):""}</div>${m.group_id?`<div class="muted">${esc(groups.find(g=>g.id===m.group_id)?.name||"Group")}</div>`:""}<div class="clockline">${m.duration_minutes?`${m.duration_minutes} minutes`:"Duration not set"}${elapsed}</div>${m.note?`<p class="notice">${esc(m.note)}</p>`:""}${alertButton}${poll}</article>`;
}
async function loadPolls(){
  for(const m of matches){
    if(m.status!=="upcoming"||!m.kickoff||new Date(m.kickoff)<=new Date())continue;
    const {data,error}=await db.rpc("get_match_vote_counts",{p_match_id:m.id});
    const el=$("poll-"+m.id);if(error||!el)continue;
    const v=Array.isArray(data)?data[0]:data;if(!v)continue;
    const h=+v.home_votes||0,d=+v.draw_votes||0,a=+v.away_votes||0,total=+v.total_votes||0;
    const pct=n=>total?Math.round(n*100/total):0;
    el.textContent=`${total} votes · ${m.home} ${pct(h)}% · Draw ${pct(d)}% · ${m.away} ${pct(a)}%`;
  }
}
async function submitVote(matchId,choice){
  const m=matches.find(x=>String(x.id)===String(matchId));
  if(!m||m.status!=="upcoming"||new Date(m.kickoff)<=new Date()){alert("Voting has closed.");return;}
  const {error}=await db.rpc("cast_match_vote",{p_match_id:matchId,p_voter_token:voterToken(),p_choice:choice});
  if(error){alert(error.message.includes("already voted")?"You have already voted in this match.":error.message);return;}
  await loadPolls();
}

function getFilteredMatches(){
  return sportFilter==="all"?matches:matches.filter(m=>(m.sport||"Football")===sportFilter);
}
function renderPublic(){
  const list=getFilteredMatches();
  const sections=[["liveList",list.filter(m=>m.status==="live")],["fixtureList",list.filter(m=>m.status==="upcoming").sort((a,b)=>new Date(a.kickoff)-new Date(b.kickoff))],["resultList",list.filter(m=>m.status==="finished").sort((a,b)=>new Date(b.kickoff)-new Date(a.kickoff))]];
  for(const [id,items] of sections){const el=$(id);if(el)el.innerHTML=items.length?items.map(matchCard).join(""):`<div class="match-card empty">No ${id==="liveList"?"live matches":id==="fixtureList"?"upcoming fixtures":"results"} published yet.</div>`;}
  populatePublicCompetitionFilter();
  renderStandings();
  loadPolls();
}
function populatePublicCompetitionFilter(){
  const select=$("publicCompetitionFilter");if(!select)return;
  const old=select.value;
  select.innerHTML='<option value="all">All competitions</option>'+competitions.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  if([...select.options].some(o=>o.value===old))select.value=old;
  populatePublicGroupFilter();
}
function populatePublicGroupFilter(){
  const select=$("publicGroupFilter");if(!select)return;
  const comp=$("publicCompetitionFilter").value;
  const relevant=groups.filter(g=>comp==="all"||g.competition_id===comp);
  const old=select.value;
  select.innerHTML='<option value="all">All groups</option>'+relevant.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("");
  if([...select.options].some(o=>o.value===old))select.value=old;
}
function renderStandings(){
  const body=$("standingsBody");if(!body)return;
  const compId=$("publicCompetitionFilter")?.value||"all";
  const groupId=$("publicGroupFilter")?.value||"all";
  let registered=entries.filter(e=>(compId==="all"||e.competition_id===compId)&&(groupId==="all"||e.group_id===groupId));
  if(compId==="all"){
    const unique=new Map();registered.forEach(e=>unique.set(`${e.competition_id}:${e.team_id}`,e));registered=[...unique.values()];
  }
  const stats=new Map();
  for(const e of registered){
    const t=teams.find(x=>x.id===e.team_id);if(!t)continue;
    const key=`${e.competition_id}:${e.group_id||"ungrouped"}:${e.team_id}`;
    stats.set(key,{name:t.name,competition_id:e.competition_id,group_id:e.group_id,p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0});
  }
  const relevantMatches=matches.filter(m=>m.status==="finished"&&m.match_type!=="friendly"&&m.sport!=="Athletics"&&m.home_team_id&&m.away_team_id&&(compId==="all"||m.competition_id===compId)&&(groupId==="all"||m.group_id===groupId));
  for(const m of relevantMatches){
    const homeKey=`${m.competition_id}:${m.group_id||"ungrouped"}:${m.home_team_id}`;
    const awayKey=`${m.competition_id}:${m.group_id||"ungrouped"}:${m.away_team_id}`;
    if(!stats.has(homeKey)||!stats.has(awayKey))continue;
    const a=stats.get(homeKey),b=stats.get(awayKey),x=Number(m.home_score)||0,y=Number(m.away_score)||0;
    a.p++;b.p++;a.gf+=x;a.ga+=y;b.gf+=y;b.ga+=x;
    if(x>y){a.w++;a.pts+=3;b.l++;}
    else if(x<y){b.w++;b.pts+=3;a.l++;}
    else{a.d++;b.d++;a.pts++;b.pts++;}
  }
  const rows=[...stats.values()].sort((a,b)=>b.pts-a.pts||(b.gf-b.ga)-(a.gf-a.ga)||b.gf-a.gf||a.name.localeCompare(b.name));
  if(!rows.length){body.innerHTML='<tr><td colspan="10" class="empty">Register teams in a competition and complete competitive matches to build standings.</td></tr>';return;}
  body.innerHTML=rows.map((s,i)=>`<tr><td>${i+1}</td><td>${esc(s.name)}</td><td>${s.p}</td><td>${s.w}</td><td>${s.d}</td><td>${s.l}</td><td>${s.gf}</td><td>${s.ga}</td><td>${s.gf-s.ga}</td><td><b>${s.pts}</b></td></tr>`).join("");
}

function fillSelect(id,items,placeholder,mapper){
  const el=$(id);if(!el)return;
  const old=el.value;el.innerHTML=`<option value="">${esc(placeholder)}</option>`+items.map(item=>{const o=mapper(item);return `<option value="${esc(o.value)}">${esc(o.label)}</option>`;}).join("");
  if([...el.options].some(o=>o.value===old))el.value=old;
}
function populateAdminSelects(){
  fillSelect("matchCompetition",competitions,"Friendly / no competition",c=>({value:c.id,label:c.name}));
  fillSelect("stageCompetition",competitions,"Choose competition",c=>({value:c.id,label:c.name}));
  fillSelect("groupCompetition",competitions,"Choose competition",c=>({value:c.id,label:c.name}));
  fillSelect("entryCompetition",competitions,"Choose competition",c=>({value:c.id,label:c.name}));
  fillSelect("entryTeam",teams,"Choose team",t=>({value:t.id,label:`${t.name} · ${t.sport}`}));
  fillSelect("teamSchool",schools,"Independent / no linked school",s=>({value:s.id,label:s.name}));
  fillSelect("homeTeamSelect",teams,"Choose team",t=>({value:t.id,label:`${t.name} · ${t.sport}`}));
  fillSelect("awayTeamSelect",teams,"Choose team",t=>({value:t.id,label:`${t.name} · ${t.sport}`}));
  refreshGroupAndStageOptions();
  renderCompetitionLists();
  renderTeamLists();
  renderGroupLists();
}
function refreshGroupAndStageOptions(){
  const compId=$("matchCompetition")?.value;
  const groupOptions=groups.filter(g=>!compId||g.competition_id===compId);
  fillSelect("matchGroup",groupOptions,"No group",g=>({value:g.id,label:g.name}));
  const stageOptions=stages.filter(s=>!compId||s.competition_id===compId);
  fillSelect("matchStage",stageOptions,"No stage",s=>({value:s.id,label:s.name}));
  const groupComp=$("groupCompetition")?.value;
  fillSelect("entryGroup",groups.filter(g=>!groupComp||g.competition_id===groupComp),"No group",g=>({value:g.id,label:g.name}));
}
function renderCompetitionLists(){
  const box=$("adminCompetitions");if(!box)return;
  box.innerHTML=competitions.length?competitions.map(c=>`<div class="admin-row"><div><b>${esc(c.name)}</b><div class="muted">${esc(c.sport)} · ${esc(c.status||"upcoming")}</div></div><span class="muted">${stages.filter(s=>s.competition_id===c.id).length} stages</span><button class="danger" data-delete-competition="${esc(c.id)}">Delete</button></div>`).join(""):"<p class='notice'>No competitions created yet.</p>";
  box.querySelectorAll("[data-delete-competition]").forEach(b=>b.onclick=()=>deleteCompetition(b.dataset.deleteCompetition));
}
function renderTeamLists(){
  const box=$("adminTeams");if(!box)return;
  box.innerHTML=teams.length?teams.map(t=>`<div class="admin-row"><div><b>${esc(t.name)}</b><div class="muted">${esc(t.team_type)} · ${esc(t.sport)}</div></div><button class="danger" data-delete-team="${esc(t.id)}">Delete</button></div>`).join(""):"<p class='notice'>No teams registered yet.</p>";
  box.querySelectorAll("[data-delete-team]").forEach(b=>b.onclick=()=>deleteTeam(b.dataset.deleteTeam));
}
function renderGroupLists(){
  const box=$("adminGroups");if(!box)return;
  const groupHtml=groups.map(g=>{const c=competitions.find(x=>x.id===g.competition_id);const members=entries.filter(e=>e.group_id===g.id).map(e=>teams.find(t=>t.id===e.team_id)?.name).filter(Boolean);return `<div class="admin-row"><div><b>${esc(c?.name||"Competition")} — ${esc(g.name)}</b><div class="muted">${members.length?members.map(esc).join(", "):"No teams assigned yet"}</div></div><button class="danger" data-delete-group="${esc(g.id)}">Delete group</button></div>`;}).join("");
  const ungrouped=entries.filter(e=>!e.group_id).map(e=>{const c=competitions.find(x=>x.id===e.competition_id),t=teams.find(x=>x.id===e.team_id);return `<div class="admin-row"><div>${esc(t?.name||"Team")} · ${esc(c?.name||"Competition")} <span class="muted">(no group)</span></div></div>`;}).join("");
  box.innerHTML=groupHtml+ungrouped||"<p class='notice'>No groups or competition entries yet.</p>";
  box.querySelectorAll("[data-delete-group]").forEach(b=>b.onclick=()=>deleteGroup(b.dataset.deleteGroup));
}
async function loadCoreData(){
  const requests=[
    db.from("matches").select("*").order("kickoff",{ascending:true}),
    db.from("competitions").select("*").order("created_at",{ascending:false}),
    db.from("teams").select("*").order("name"),
    db.from("competition_groups").select("*").order("name"),
    db.from("competition_stages").select("*").order("stage_order"),
    db.from("schools").select("*").order("name"),
    db.from("competition_teams").select("*")
  ];
  const results=await Promise.all(requests);
  const labels=["matches","competitions","teams","groups","stages","schools","competition entries"];
  results.forEach((r,i)=>{if(r.error){console.error(`Could not load ${labels[i]}:`,r.error.message);return;}});
  matches=results[0].data||[];
  competitions=results[1].data||[];
  teams=results[2].data||[];
  groups=results[3].data||[];
  stages=results[4].data||[];
  schools=results[5].data||[];
  entries=results[6].data||[];
  renderPublic();populateAdminSelects();renderAdminMatches();
}
function renderAdminMatches(){
  const box=$("adminMatches");if(!box)return;
  box.innerHTML=matches.length?matches.map(m=>{
    const set=canSetDuration(m);
    const stage=stages.find(s=>s.id===m.stage_id)?.name||m.stage||"";
    return `<div class="admin-row"><div><b>${icons[m.sport]||"🏅"} ${esc(m.home)} ${Number(m.home_score)||0}–${Number(m.away_score)||0} ${esc(m.away)}</b><div class="muted">${esc(m.competition||"No competition")} · ${esc(m.match_type||"unclassified")} · ${esc(m.status)} · ${fmtDate(m.kickoff)} ${stage?"· "+esc(stage):""}</div></div><div class="admin-actions">${set?`<button data-action="duration" data-id="${esc(m.id)}">Set duration</button>`:""}<button data-action="start" data-id="${esc(m.id)}">Start / Resume</button><button data-action="pause" data-id="${esc(m.id)}">Pause</button>${m.status==="live"&&m.period_status!=="halftime"?`<button data-action="halftime" data-id="${esc(m.id)}">Half-time</button>`:""}<button data-action="finish" data-id="${esc(m.id)}">Finish</button><button data-action="score" data-id="${esc(m.id)}">Edit score</button><button class="danger" data-action="delete" data-id="${esc(m.id)}">Delete</button></div></div>`;
  }).join(""):"<p class='notice'>No matches published yet.</p>";
  box.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>adminAction(b.dataset.action,b.dataset.id));
}
function canSetDuration(m){const delta=new Date(m.kickoff).getTime()-Date.now();return delta<=300000&&delta>=0;}
async function loadCoreDataSafe(){try{await loadCoreData();}catch(error){console.error(error);}}
async function updateMatch(id,patch){
  const {error}=await db.from("matches").update(patch).eq("id",id);
  if(error){alert(error.message);return false;}
  await loadCoreDataSafe();return true;
}
async function adminAction(action,id){
  const m=matches.find(x=>x.id===id);if(!m)return;
  if(action==="delete"){if(confirm("Delete this match?")){const {error}=await db.from("matches").delete().eq("id",id);if(error)alert(error.message);else loadCoreDataSafe();}return;}
  if(action==="duration"){
    if(!canSetDuration(m)){alert("Duration can only be set during the five minutes immediately before kick-off.");return;}
    const d=prompt("Total playing duration in minutes:",m.duration_minutes||"");if(d===null||!Number.isFinite(+d)||+d<=0)return;
    const p=prompt("Number of periods / halves / quarters:",m.period_count||"2");if(p===null||!Number.isFinite(+p)||+p<1)return;
    const br=prompt("Break duration in minutes:",m.break_minutes??"5");if(br===null||!Number.isFinite(+br)||+br<0)return;
    await updateMatch(id,{duration_minutes:+d,period_count:Math.floor(+p),period_minutes:Math.ceil(+d/Math.floor(+p)),break_minutes:+br});return;
  }
  if(action==="start"){
    const first=m.status==="upcoming";
    const ok=await updateMatch(id,{status:"live",period_status:"running",timer_started_at:new Date().toISOString()});
    if(ok&&first)await sendMatchNotification(m,"kickoff",`⚽ Kick-off! ${m.home} vs ${m.away} has started.`,`${id}-kickoff`);
    return;
  }
  if(action==="pause"){await updateMatch(id,{status:"paused",period_status:"paused",timer_started_at:null});return;}
  if(action==="halftime"){
    if(m.status!=="live")return;
    const ok=await updateMatch(id,{timer_started_at:null,period_status:"halftime"});
    if(ok)await sendMatchNotification(m,"halftime",`⏸️ Half-time: ${m.home} ${+m.home_score||0}–${+m.away_score||0} ${m.away}.`,`${id}-halftime`);
    return;
  }
  if(action==="finish"){
    const ok=await updateMatch(id,{status:"finished",timer_started_at:null,period_status:"finished"});
    if(ok)await sendMatchNotification(m,"fulltime",`🏁 Full-time: ${m.home} ${+m.home_score||0}–${+m.away_score||0} ${m.away}.`,`${id}-fulltime`);
    return;
  }
  if(action==="score"){
    const h=prompt("Home score:",m.home_score??0);if(h===null||!Number.isFinite(+h)||+h<0)return;
    const a=prompt("Away score:",m.away_score??0);if(a===null||!Number.isFinite(+a)||+a<0)return;
    const hs=Math.floor(+h),as=Math.floor(+a);
    const ok=await updateMatch(id,{home_score:hs,away_score:as});if(!ok)return;
    const oldH=+m.home_score||0,oldA=+m.away_score||0;
    if(hs>oldH)await sendMatchNotification(m,"goal",`🥅 GOAL! ${m.home} scores. ${m.home} ${hs}–${as} ${m.away}.`,`${id}-goal-home-${hs}-${as}`);
    if(as>oldA)await sendMatchNotification(m,"goal",`🥅 GOAL! ${m.away} scores. ${m.home} ${hs}–${as} ${m.away}.`,`${id}-goal-away-${hs}-${as}`);
  }
}
async function deleteCompetition(id){
  if(!confirm("Delete this competition? Related entries, groups and stages may also need cleanup. Continue?"))return;
  const {error}=await db.from("competitions").delete().eq("id",id);
  if(error){alert(error.message);return;}await loadCoreDataSafe();
}
async function deleteTeam(id){
  if(!confirm("Delete this team? Teams already used in matches may be protected by database references."))return;
  const {error}=await db.from("teams").delete().eq("id",id);
  if(error){alert(error.message);return;}await loadCoreDataSafe();
}
async function deleteGroup(id){
  if(!confirm("Delete this group?"))return;
  const {error}=await db.from("competition_groups").delete().eq("id",id);
  if(error){alert(error.message);return;}await loadCoreDataSafe();
}
function bindForms(){
  $("competitionForm").onsubmit=async e=>{
    e.preventDefault();const row=formObject(e.currentTarget);
    const {error}=await db.from("competitions").insert(row);
    say("competitionMsg",error?error.message:"Competition created.");
    if(!error){e.currentTarget.reset();await loadCoreDataSafe();}
  };
  $("teamForm").onsubmit=async e=>{
    e.preventDefault();const row=formObject(e.currentTarget);
    if(row.team_type==="independent"||!row.school_id)row.school_id=null;
    const {error}=await db.from("teams").insert(row);
    say("teamMsg",error?error.message:"Team registered.");
    if(!error){e.currentTarget.reset();await loadCoreDataSafe();}
  };
  $("groupForm").onsubmit=async e=>{
    e.preventDefault();const competition_id=$("groupCompetition").value,name=$("groupName").value.trim();
    const {error}=await db.from("competition_groups").insert({competition_id,name});
    say("groupMsg",error?error.message:"Group created.");
    if(!error){$("groupName").value="";await loadCoreDataSafe();}
  };
  $("entryForm").onsubmit=async e=>{
    e.preventDefault();const competition_id=$("entryCompetition").value,team_id=$("entryTeam").value,group_id=$("entryGroup").value||null;
    const {error}=await db.from("competition_teams").upsert({competition_id,team_id,group_id},{onConflict:"competition_id,team_id"});
    say("entryMsg",error?error.message:"Team added to competition.");
    if(!error)await loadCoreDataSafe();
  };
  $("stageForm").onsubmit=async e=>{
    e.preventDefault();const competition_id=$("stageCompetition").value,name=$("stageName").value.trim();
    const {error}=await db.from("competition_stages").insert({competition_id,name,stage_type:$("stageType").value,stage_order:Number($("stageOrder").value)||1});
    say("stageMsg",error?error.message:"Stage added.");
    if(!error){$("stageName").value="";await loadCoreDataSafe();}
  };
  $("matchForm").onsubmit=async e=>{
    e.preventDefault();
    const row=formObject(e.currentTarget);
    const homeTeam=$("homeTeamSelect").value,awayTeam=$("awayTeamSelect").value;
    if(homeTeam&&awayTeam&&homeTeam===awayTeam){say("saveMsg","Home and away teams must be different.",true);return;}
    const compId=$("matchCompetition").value||null;
    const groupId=$("matchGroup").value||null;
    const stageId=$("matchStage").value||null;
    const kickoff=new Date(row.kickoff);
    if(isNaN(kickoff)){say("saveMsg","Please enter a valid kick-off time.",true);return;}
    const homeTeamRow=teams.find(t=>t.id===homeTeam),awayTeamRow=teams.find(t=>t.id===awayTeam);
    const payload={
      sport:row.sport,competition_id:compId,group_id:groupId,stage_id:stageId,
      home_team_id:homeTeam||null,away_team_id:awayTeam||null,
      home:homeTeamRow?.name||row.home,away:awayTeamRow?.name||row.away,
      competition:competitions.find(c=>c.id===compId)?.name||"Friendly",
      match_type:row.match_type||"competitive",kickoff:kickoff.toISOString(),
      venue:row.venue||null,status:row.status||"upcoming",
      home_score:Number(row.home_score)||0,away_score:Number(row.away_score)||0,
      note:row.note||null,duration_minutes:null,period_count:null,period_minutes:null,break_minutes:null,
      stage:stages.find(s=>s.id===stageId)?.name||null
    };
    const {error}=await db.from("matches").insert(payload);
    say("saveMsg",error?error.message:"Match published successfully.");
    if(!error){e.currentTarget.reset();await loadCoreDataSafe();}
  };
}
function bindUI(){
  $("year").textContent=new Date().getFullYear();
  $("adminOpen").onclick=()=>$("adminDialog").showModal();
  $("adminClose").onclick=()=>$("adminDialog").close();
  $("loginBtn").onclick=async()=>{
    const {data,error}=await db.auth.signInWithPassword({email:$("email").value,password:$("password").value});
    if(error){say("loginMsg",error.message,true);return;}await showAdmin(data.user);
  };
  $("logoutBtn").onclick=async()=>{await db.auth.signOut();$("managePanel").classList.add("hidden");$("loginPanel").classList.remove("hidden");};
  document.querySelectorAll(".sport-chip").forEach(b=>b.onclick=()=>{sportFilter=b.dataset.sport;document.querySelectorAll(".sport-chip").forEach(x=>x.classList.toggle("active",x===b));renderPublic();});
  document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{
    document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));
    document.querySelectorAll(".admin-section").forEach(x=>x.classList.toggle("hidden",x.id!==b.dataset.tab));
  });
  $("publicCompetitionFilter").onchange=()=>{populatePublicGroupFilter();renderStandings();};
  $("publicGroupFilter").onchange=renderStandings;
  $("matchCompetition").onchange=refreshGroupAndStageOptions;
  $("groupCompetition").onchange=refreshGroupAndStageOptions;
  $("entryCompetition").onchange=refreshGroupAndStageOptions;
  $("homeTeamSelect").onchange=()=>{const t=teams.find(x=>x.id===$("homeTeamSelect").value);if(t)$("homeName").value=t.name;};
  $("awayTeamSelect").onchange=()=>{const t=teams.find(x=>x.id===$("awayTeamSelect").value);if(t)$("awayName").value=t.name;};
  $("teamType").onchange=()=>{$("teamSchool").disabled=$("teamType").value==="independent";};
  $("matchSport").onchange=()=>{const sport=$("matchSport").value;const filtered=teams.filter(t=>t.sport===sport);fillSelect("homeTeamSelect",filtered,"Choose team",t=>({value:t.id,label:t.name}));fillSelect("awayTeamSelect",filtered,"Choose team",t=>({value:t.id,label:t.name}));};
  $("adminDialog").addEventListener("click",e=>{if(e.target===$("adminDialog"))$("adminDialog").close();});
}
async function showAdmin(user){
  const {data,error}=await db.rpc("is_harris_admin");
  if(error||data!==true){await db.auth.signOut();say("loginMsg","This account is not authorised to administer Harris Livescore.",true);return;}
  $("loginPanel").classList.add("hidden");$("managePanel").classList.remove("hidden");$("adminIdentity").textContent=user.email;
  await loadCoreDataSafe();
}
function startWatcherCount(){
  if(!db)return;
  const channel=db.channel("harris-site-visitors",{config:{presence:{key:crypto.randomUUID()}}});
  channel.on("presence",{event:"sync"},()=>{$("watcherCount").textContent=Object.keys(channel.presenceState()).length;}).subscribe(async status=>{if(status==="SUBSCRIBED")await channel.track({online_at:new Date().toISOString()});});
}
async function init(){
  if(!db){alert("Supabase failed to load. Check your internet connection.");return;}
  bindUI();bindForms();startWatcherCount();
  await loadCoreDataSafe();
  const {data}=await db.auth.getSession();if(data.session)await showAdmin(data.session.user);
  db.channel("harris-match-changes").on("postgres_changes",{event:"*",schema:"public",table:"matches"},loadCoreDataSafe).subscribe();
  for(const table of ["competitions","teams","competition_groups","competition_teams","competition_stages"]){
    db.channel("harris-"+table).on("postgres_changes",{event:"*",schema:"public",table},loadCoreDataSafe).subscribe();
  }
  setInterval(()=>{if(matches.length)renderPublic();},15000);
  if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(console.error));}
}
document.addEventListener("click",e=>{
  const vote=e.target.closest("[data-vote]");if(vote){submitVote(vote.dataset.match,vote.dataset.vote);return;}
  const alertButton=e.target.closest("[data-alert]");if(alertButton)enableMatchAlerts(alertButton.dataset.alert,alertButton);
});
document.addEventListener("DOMContentLoaded",init);
