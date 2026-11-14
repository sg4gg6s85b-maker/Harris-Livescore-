const SUPABASE_URL="https://qhqlvknmkpiwgvjbyetp.supabase.co";
const SUPABASE_ANON_KEY="sb_publishable_Nx-gEll1DYYydixyCjQ80Q_JG5YUGQt";
const VAPID_PUBLIC_KEY = "BLgd9LoQJd7JBYbY9qKi9xj0MGjXe8sYOFjRqcvZ3HToN5XEz2ffygO4GIyiRa0ItwiPruFOkRrJo-P4vSPgkwg";
const db=window.supabase?.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let matches=[],sportFilter="all";
const fmtDate=v=>{const d=new Date(v);return isNaN(d)?"Date TBC":d.toLocaleString([],{dateStyle:"medium",timeStyle:"short"});};
const sportIcon={Football:"⚽",Basketball:"🏀",Volleyball:"🏐",Handball:"🤾",Athletics:"🏃"};
function durationText(m){if(!m.duration_minutes)return "Duration not set";const n=Number(m.duration_minutes);return `${n} min${m.period_count>1?` · ${m.period_count} periods of ${m.period_minutes||Math.ceil(n/m.period_count)} min`:""}`;}
function card(m){let st=m.status||"upcoming";let clock=m.status==="live"&&m.timer_started_at?` · ${Math.max(0,Math.floor((Date.now()-new Date(m.timer_started_at).getTime())/60000))}'`:"";let poll=st==="upcoming"&&new Date(m.kickoff)>new Date()?`<div class="fan-poll" data-poll="${esc(m.id)}"><b>Who will win?</b><div class="poll-buttons"><button type="button" data-vote="home" data-match="${esc(m.id)}">${esc(m.home)}</button><button type="button" data-vote="draw" data-match="${esc(m.id)}">Draw</button><button type="button" data-vote="away" data-match="${esc(m.id)}">${esc(m.away)}</button></div><div class="poll-results" id="poll-${esc(m.id)}">Loading votes…</div><small>One vote per browser for this match. Voting closes at kick-off.</small></div>`:"";let alertButton=st==="upcoming"&&m.kickoff&&new Date(m.kickoff)>new Date()?`<button type="button" data-alert="${esc(m.id)}">🔔 Get Match Alerts</button>`:"";return `<article class="match-card"><div class="match-meta"><span>${sportIcon[m.sport]||"🏅"} ${esc(m.sport||"Sport")} · ${esc(m.competition)}</span><span class="status ${esc(st)}">${st==="finished"?"FULL TIME":st==="live"?"● LIVE":st.toUpperCase()}</span></div><div class="teams"><span>${esc(m.home)}</span><span class="score">${st==="upcoming"?"—":Number(m.home_score)||0}</span><span>${esc(m.away)}</span><span class="score">${st==="upcoming"?"—":Number(m.away_score)||0}</span></div><div class="venue">${fmtDate(m.kickoff)}${m.venue?" · "+esc(m.venue):""}</div><div class="clockline">${durationText(m)}${clock}</div>${m.note?`<p class="notice">${esc(m.note)}</p>`:""}${alertButton}${poll}</article>`}
function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, "+")
        .replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from(rawData, c => c.charCodeAt(0));
}

async function enableMatchAlerts(matchId, button) {
    try {
        if (!("serviceWorker" in navigator) ||
            !("PushManager" in window) ||
            !("Notification" in window)) {
            alert("Your browser does not support match notifications.");
            return;
        }

        if (!VAPID_PUBLIC_KEY ||
            VAPID_PUBLIC_KEY === "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE") {
            alert("The notification public key has not been added.");
            return;
        }

        const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const isStandalone =
            window.matchMedia("(display-mode: standalone)").matches ||
            navigator.standalone === true;

        if (isIOS && !isStandalone) {
            alert("Add Harris Livescore to your Home Screen and open it from there first.");
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
            alert("Please allow notifications.");
            return;
        }

        button.disabled = true;
        button.textContent = "Enabling alerts...";

        const registration =
            await navigator.serviceWorker.register("/sw.js");

        const subscription =
            await registration.pushManager.getSubscription() ||
            await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey:
                    urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });

        const { data, error } = await db.functions.invoke(
            "save-match-subscription",
            {
                body: {
                    match_id: matchId,
                    subscription: subscription.toJSON()
                }
            }
        );

        if (error) throw error;

        button.textContent = "🔔 Alerts Enabled";
        alert(data?.message || "Match alerts enabled!");

    } catch (error) {
        console.error(error);
        button.textContent = "🔔 Get Match Alerts";
        alert("Could not enable alerts. Please try again.");
    } finally {
        button.disabled = false;
    }
}
function voterToken(){let t=localStorage.getItem("harris_voter_token");if(!t){t=crypto.randomUUID();localStorage.setItem("harris_voter_token",t);}return t;}
async function loadPolls(){for(const m of matches){if(m.status!=="upcoming"||new Date(m.kickoff)<=new Date())continue;let {data,error}=await db.rpc("get_match_vote_counts",{p_match_id:m.id});let el=$("poll-"+m.id);if(error||!el)continue;let v=Array.isArray(data)?data[0]:data;if(!v)continue;let h=+v.home_votes||0,d=+v.draw_votes||0,a=+v.away_votes||0,total=+v.total_votes||0;let pct=n=>total?Math.round(n*100/total):0;el.innerHTML=`${total} vote${total===1?"":"s"} · ${esc(m.home)} ${pct(h)}% · Draw ${pct(d)}% · ${esc(m.away)} ${pct(a)}%`;}}
async function submitVote(matchId,choice){let m=matches.find(x=>String(x.id)===String(matchId));if(!m||m.status!=="upcoming"||new Date(m.kickoff)<=new Date()){alert("Voting has closed for this match.");return;}let {error}=await db.rpc("cast_match_vote",{p_match_id:matchId,p_voter_token:voterToken(),p_choice:choice});if(error){alert(error.message.includes("already voted")?"You have already voted in this match.":error.message);return;}await loadPolls();}
document.addEventListener("click",e=>{let b=e.target.closest("button[data-vote]");if(b)submitVote(b.dataset.match,b.dataset.vote);});
document.addEventListener("click", e => {
    const b = e.target.closest("button[data-alert]");
    if (b) enableMatchAlerts(b.dataset.alert, b);
});
document.addEventListener("click", e => {
    const button = e.target.closest("button[data-alert]");
    if (button) {
        enableMatchAlerts(button.dataset.alert, button);
    }
});
function startWatcherCount(){if(!db)return;let ch=db.channel("harris-site-visitors",{config:{presence:{key:crypto.randomUUID()}}});ch.on("presence",{event:"sync"},()=>{$("watcherCount").textContent=Object.keys(ch.presenceState()).length;}).subscribe(async status=>{if(status==="SUBSCRIBED")await ch.track({online_at:new Date().toISOString()});});}
function visible(){return sportFilter==="all"?matches:matches.filter(m=>(m.sport||"Football")===sportFilter)}
function render(){let ms=visible();for(const [id,list] of [["liveList",ms.filter(m=>m.status==="live")],["fixtureList",ms.filter(m=>m.status==="upcoming").sort((a,b)=>new Date(a.kickoff)-new Date(b.kickoff))],["resultList",ms.filter(m=>m.status==="finished").sort((a,b)=>new Date(b.kickoff)-new Date(a.kickoff))]])$(id).innerHTML=list.length?list.map(card).join(""):`<div class="match-card empty">No ${id==="liveList"?"live matches":id==="fixtureList"?"upcoming fixtures":"results"} published yet.</div>`;renderStandings(ms);renderAdmin();}
function renderStandings(ms){let stats={};ms.filter(m=>m.status==="finished"&&m.sport!=="Athletics"&&m.sport!=="Volleyball").forEach(m=>{for(let n of [m.home,m.away])stats[n]??={p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0};let a=stats[m.home],b=stats[m.away],x=+m.home_score||0,y=+m.away_score||0;a.p++;b.p++;a.gf+=x;a.ga+=y;b.gf+=y;b.ga+=x;if(x>y){a.w++;a.pts+=3;b.l++}else if(x<y){b.w++;b.pts+=3;a.l++}else{a.d++;b.d++;a.pts++;b.pts++}});let rows=Object.entries(stats).sort((a,b)=>b[1].pts-a[1].pts||(b[1].gf-b[1].ga)-(a[1].gf-a[1].ga));$("standingsBody").innerHTML=rows.length?rows.map(([n,s],i)=>`<tr><td>${i+1}</td><td>${esc(n)}</td><td>${s.p}</td><td>${s.w}</td><td>${s.d}</td><td>${s.l}</td><td>${s.gf-s.ga}</td><td><b>${s.pts}</b></td></tr>`).join(""):`<tr><td colspan="8" class="empty">Standings will appear when completed matches are added.</td></tr>`;}
function canSetDuration(m){let delta=new Date(m.kickoff).getTime()-Date.now();return delta<=300000&&delta>=0;}
function renderAdmin(){let box=$("adminMatches");if(!box)return;box.innerHTML=matches.length?matches.map(m=>{let set=canSetDuration(m);return `<div class="admin-row"><div class="admin-row-head"><span><b>${sportIcon[m.sport]||"🏅"} ${esc(m.home)} ${+m.home_score||0}–${+m.away_score||0} ${esc(m.away)}</b><br>${esc(m.competition)} · ${esc(m.status)} · ${fmtDate(m.kickoff)}</span><button class="danger" data-action="delete" data-id="${m.id}">Delete</button></div><div class="clockline">${durationText(m)} ${set?"· Duration setting window is OPEN":""}</div><div class="admin-actions">${set?`<button data-action="duration" data-id="${m.id}">Set duration now</button>`:""}<button data-action="live" data-id="${m.id}">Start / Resume</button><button data-action="pause" data-id="${m.id}">Pause</button><button data-action="finish" data-id="${m.id}">Finish</button><button data-action="score" data-id="${m.id}">Edit score</button></div></div>`}).join(""):"<p class='notice'>No matches published.</p>";box.querySelectorAll("button[data-action]").forEach(b=>b.onclick=()=>adminAction(b.dataset.action,b.dataset.id));}
async function load(){if(!db)return;let {data,error}=await db.from("matches").select("*").order("kickoff",{ascending:true});if(error){console.error(error);return;}matches=data||[];render();loadPolls();}
async function update(id,patch){let {error}=await db.from("matches").update(patch).eq("id",id);if(error)alert(error.message);else await load();}
async function adminAction(action,id){let m=matches.find(x=>x.id===id);if(!m)return;if(action==="delete"){if(confirm("Delete this match?")){let {error}=await db.from("matches").delete().eq("id",id);if(error)alert(error.message);else load();}return;}
if(action==="duration"){if(!canSetDuration(m)){alert("Duration can only be set during the five minutes immediately before scheduled start.");return;}let d=prompt("Enter total playing duration in minutes:",m.duration_minutes||"");if(!d||!Number.isFinite(+d)||+d<=0)return;let periods=prompt("Number of periods/halves/quarters (enter 1 if not applicable):",m.period_count||"2");let breakM=prompt("Break duration in minutes:",m.break_minutes??"5");await update(id,{duration_minutes:+d,period_count:+periods||1,period_minutes:Math.ceil(+d/(+periods||1)),break_minutes:+breakM||0});return;}
if(action==="live"){await update(id,{status:"live",timer_started_at:new Date().toISOString()});return;}
if(action==="pause"){await update(id,{status:"paused",timer_started_at:null});return;}
if(action==="finish"){await update(id,{status:"finished",timer_started_at:null});return;}
if(action==="score"){let h=prompt("Home score:",m.home_score??0);if(h===null)return;let a=prompt("Away score:",m.away_score??0);if(a===null)return;await update(id,{home_score:+h||0,away_score:+a||0});}}
$("year").textContent=new Date().getFullYear();
$("adminOpen").onclick=()=>$("adminDialog").showModal();
$("loginBtn").onclick=async()=>{let {data,error}=await db.auth.signInWithPassword({email:$("email").value,password:$("password").value});if(error){$("loginMsg").textContent=error.message;return;}await showAdmin(data.user);};
async function showAdmin(user){let {data:ok,error}=await db.rpc("is_harris_admin");if(error||ok!==true){await db.auth.signOut();$("loginMsg").textContent="This account is not authorised to administer Harris Livescore.";return;}$("loginPanel").classList.add("hidden");$("managePanel").classList.remove("hidden");$("adminIdentity").textContent=user.email;load();}
$("logoutBtn").onclick=async()=>{await db.auth.signOut();$("managePanel").classList.add("hidden");$("loginPanel").classList.remove("hidden");};
$("matchForm").onsubmit=async e=>{e.preventDefault();let f=new FormData(e.currentTarget),r=Object.fromEntries(f.entries());r.home_score=+r.home_score||0;r.away_score=+r.away_score||0;r.kickoff=new Date(r.kickoff).toISOString();r.duration_minutes=null;r.period_count=null;r.period_minutes=null;r.break_minutes=null;let {error}=await db.from("matches").insert(r);$("saveMsg").textContent=error?error.message:"Match published. Its duration can be set five minutes before start.";if(!error){e.currentTarget.reset();load();}};
document.querySelectorAll(".sport-chip").forEach(b=>b.onclick=()=>{sportFilter=b.dataset.sport;document.querySelectorAll(".sport-chip").forEach(x=>x.classList.toggle("active",x===b));render();});
if(db){startWatcherCount();db.auth.getSession().then(({data})=>{if(data.session)showAdmin(data.session.user);});db.channel("match-updates").on("postgres_changes",{event:"*",schema:"public",table:"matches"},load).subscribe();}
setInterval(()=>{if(matches.length)render();},15000);load();
// Register Harris Livescore notification service worker
if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
        try {
            const registration =
                await navigator.serviceWorker.register("/sw.js");

            console.log(
                "Harris Match Alerts ready:",
                registration.scope
            );
        } catch (error) {
            console.error("Notification setup failed:", error);
        }
    });
}
