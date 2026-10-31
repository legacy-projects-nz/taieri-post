
(function(){
"use strict";
/* the whole board is a working surface, not a document: no click-to-comment anywhere */
try{document.documentElement.setAttribute("data-uncommentable","");document.body.setAttribute("data-uncommentable","");}catch(e){}
document.addEventListener("contextmenu",function(ev){if(!(ev.target.closest&&ev.target.closest("input,textarea")))ev.preventDefault();});
var DAYS=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
var DEFAULT_DRIVERS=[
 {id:"A",name:"Amar"},{id:"C",name:"Cole"},{id:"CB",name:"Courtney",cleared:true},{id:"CH",name:"Cherie"},
 {id:"G",name:"Grace"},{id:"J",name:"Jeremy"},{id:"JA",name:"James"},{id:"N",name:"Nicolas",cleared:true},{id:"SJ",name:"Sunjeep"}
];
var ADDONS=[
 {id:"outram",name:"Outram Depot",short:"Outram",min:10},
 {id:"pgg",name:"PGG",short:"PGG",min:10},
 {id:"airport",name:"Airport",short:"Airport",min:30},
 {id:"milton",name:"Milton",short:"Milton",min:90},
 {id:"balclutha",name:"Balclutha",short:"Balclutha",min:90},
 {id:"owaka",name:"Owaka",short:"Owaka",min:90},
 /* RSB / PCB receivers & pick-ups: tasks done inside the run (no minutes added); timings from the Receivers / Pick Up Timing chat.
    The drivers post a game plan by 11am and then post each one done; Harbour Fish by 1pm and a Fonterra post by 3pm are checked by the scorecard. */
 {id:"rose",name:"Roseneath receiver",short:"Rose",min:0,task:1,when:"~12pm"},
 {id:"sb",name:"Sawyers Bay receiver",short:"SB",min:0,task:1,when:"~12–1:30pm"},
 {id:"fish",name:"Harbour Fish pick-up",short:"Fish",min:0,task:1,when:"by 1pm"},
 {id:"pc",name:"Port Chalmers receiver",short:"PC rcv",min:0,task:1,when:"~3pm"},
 {id:"digi",name:"Digi Art pick-up",short:"Digi",min:0,task:1,when:"~3pm"},
 {id:"fonterra",name:"Fonterra pick-up",short:"Fonterra",min:0,task:1,when:"post by 3pm"},
 /* Waihola Store: a daily stop, no time added. Normally on the Flyer; TUA or D>B can take it instead. One run each day. */
 {id:"waihola",name:"Waihola Store",short:"Waihola",min:0,task:1,when:"daily"}
];
/* add-ons a run gets by default when a new week is set up */
var DEFAULT_ADD={FLY:["waihola"]};
var WAIHOLA_RUNS=["FLY","TUA","DB"];
/* receivers and pick-ups never go out on a Saturday (28 Oct 2026) */
var NO_SAT=["rose","sb","fish","pc","digi","fonterra"];
function satBlocked(day,id){return day==="Sat"&&NO_SAT.indexOf(id)>=0;}
function addMeta(a){return a.task?a.when:(a.min>=60?"+"+(a.min/60)+"h":"+"+a.min+"m");}
var ADDON={};ADDONS.forEach(function(a){ADDON[a.id]=a;});
/* TIMING RULES as add-ons (30 Oct 2026, Jeremy): every timing rule made in the scorecard (Admin → Timing rules) can be ticked here.
   A rule can list several runs; on each day it belongs to the run it is ticked on (only one should be). A rule for one run goes to that
   run when nothing is ticked. Rules come from settings/timing {rules:[{id,name,from,to,runs,days,add,...}]}, copied by the scorecard sync.
   A rule with "add" rides on that existing add-on (e.g. Harbour Fish); otherwise it gets its own add-on "tw_<id>". */
var TW=[],TWBY={};
function twRunsOf(r){return (r.runs&&r.runs.length)?r.runs:(r.run?[r.run]:[]);}
function twAidOf(r){return r.add||("tw_"+r.id);}
function twT12(v){var a=String(v||"").split(":");if(a.length<2)return "";var h=+a[0],x=+a[1];return (h%12||12)+(x?":"+String(x).padStart(2,"0"):"")+(h>=12?"pm":"am");}
function twWhen(r){return r.from&&r.to?twT12(r.from)+"–"+twT12(r.to):r.to?"by "+twT12(r.to):r.from?"from "+twT12(r.from):"any time";}
function twShort(n){n=String(n||"").replace(/^[A-Z>+]{2,}\s*[-–:]\s*/,"").replace(/\s*(post(ed)?|done and posted)$/i,"").trim();var w=n.split(/\s+/);return w.length<=2?n:w.slice(0,2).join(" ");}
function twApply(rules){
  TW=(rules||[]).filter(function(r){return r&&r.id&&twRunsOf(r).length&&twRunsOf(r).indexOf("ALL")<0;});TWBY={};
  for(var i=ADDONS.length-1;i>=0;i--)if(ADDONS[i].tw)ADDONS.splice(i,1);
  TW.forEach(function(r){var aid=twAidOf(r);TWBY[aid]=r;if(r.add&&ADDON[r.add]&&!ADDON[r.add].tw)return;
    ADDONS.push({id:aid,name:r.name,short:twShort(r.name),min:0,task:1,when:twWhen(r),tw:1});});
  ADDON={};ADDONS.forEach(function(a){ADDON[a.id]=a;});
}
/* can this add-on go on this run and day? Own timing add-ons only go on the runs and days of their rule */
function twAllowed(day,run,id){var r=TWBY[id];if(!r||!/^tw_/.test(id))return true;return twRunsOf(r).indexOf(run)>=0&&(r.days||[]).indexOf(DAYS.indexOf(day))>=0;}
function twWhere(r){return twRunsOf(r).map(RL).join(" / ")+" · "+((r.days||[]).length===7?"every day":(r.days||[]).slice().sort().join()==="0,1,2,3,4"?"Mon–Fri":(r.days||[]).slice().sort().map(function(i){return DAYS[i];}).join(", "));}
try{var _tw=JSON.parse(localStorage.getItem("taieri-timing")||"null");if(_tw&&_tw.rules)twApply(_tw.rules);}catch(e){}
var DRIVERS=[],CLEARED=[],DNAME={};   /* rebuilt from state.cfg.drivers */
function rebuildIndex(){
  state.cfg.drivers.sort(function(a,b){return String(a.name).localeCompare(String(b.name),undefined,{sensitivity:"base"});});
  state.cfg.vans.sort(function(a,b){return String(a.plate).localeCompare(String(b.plate),undefined,{sensitivity:"base"});});
  DRIVERS=state.cfg.drivers.map(function(d){return [d.id,d.name];});
  DNAME={};CLEARED=[];
  state.cfg.drivers.forEach(function(d){DNAME[d.id]=d.name;if(d.cleared)CLEARED.push(d.id);});
}
function m(h,i){return h*60+(i||0);}
function fmt(v){var h=Math.floor(v/60),x=v%60;return (h<10?"0":"")+h+":"+(x<10?"0":"")+x;}
function hh(v){return (Math.round(v/6)/10);}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c];});}

var W={
 FLY:{name:"Flyer",net:"nzp",d:{Mon:[[m(5),m(10,30)]],Wed:[[m(5),m(9,30)]],Fri:[[m(5),m(9,30)]]}},
 WH:{name:"Saturday combined run",label:"PCB+RSB",net:"nzp",rest:1,d:{Sat:[[m(8),m(13)]]}},
 RSB:{name:"Roseneath / Sawyers Bay",net:"nzp",rest:1,hard:1,d:{Mon:[[m(12,30),m(15)]],Tue:[[m(12,30),m(17)]],Wed:[[m(12,30),m(15)]],Thu:[[m(12,30),m(17)]],Fri:[[m(12,30),m(15)]],Sat:[[m(8),m(13)]]}},
 PCB:{name:"Port Chalmers / Careys Bay",net:"nzp",rest:1,hard:1,d:{Mon:[[m(8),m(11)]],Tue:[[m(7,30),m(12)]],Wed:[[m(8),m(11)]],Thu:[[m(7,30),m(12)]],Fri:[[m(8),m(11)]],Sat:[[m(8),m(13)]]}},
 TUA:{name:"2nd Rural",net:"nzp",d:{Mon:[[m(5),m(10,45)]],Tue:[[m(5),m(9,45)]],Wed:[[m(5),m(9,45)]],Thu:[[m(5),m(9,45)]],Fri:[[m(5),m(9,45)]]}},
 RAM:{name:"Outram T-RAM",net:"nzp",hard:1,d:{Mon:[[m(13),m(16)]],Tue:[[m(13),m(16)]],Wed:[[m(13),m(16)]],Thu:[[m(13),m(16)]],Fri:[[m(13),m(16)]]}},
 LAW:{name:"Lawrence",net:"nzp",d:{Mon:[[m(9),m(13)]],Tue:[[m(9),m(13)]],Wed:[[m(9),m(13)]],Thu:[[m(9),m(13)]],Fri:[[m(9),m(13)]]}},
 S:{name:"Suburbs",label:"TGE (S)",net:"tge",d:{Mon:[[m(8),m(15,30)]],Tue:[[m(8),m(15,30)]],Wed:[[m(8),m(15,30)]],Thu:[[m(8),m(15,30)]],Fri:[[m(8),m(15,30)]]}},   /* no real mid-day break; out from 8:00 after the 6:30 TGE-depot support (Oct 2026) */
 T:{name:"Town",label:"TGE (T)",net:"tge",hard:1,d:{Mon:[[m(8),m(15,30)]],Tue:[[m(8),m(15,30)]],Wed:[[m(8),m(15,30)]],Thu:[[m(8),m(15,30)]],Fri:[[m(8),m(15,30)]]}},   /* out from 8:00 (Oct 2026) */
 DB:{name:"Dunedin › Balclutha",label:"D>B",net:"nzp",d:{Mon:[[m(5),m(10,30)]],Tue:[[m(6,30),m(11,30)]],Wed:[[m(5),m(9,30)]],Thu:[[m(6,30),m(11,30)]],Fri:[[m(5),m(9,30)]]}},   /* Mon/Wed/Fri: cross-over with the Flyer, same timing */
 SUP:{name:"NZP depot · Rural",label:"Sort – Rural",net:"nzp",novan:1,slots:4,d:{Mon:[[m(5),m(18)]],Tue:[[m(5),m(18)]],Wed:[[m(5),m(18)]],Thu:[[m(5),m(18)]],Fri:[[m(5),m(18)]],Sat:[[m(5),m(18)]]}},
 BU:{name:"Back up",label:"Back up",net:"nzp",novan:1,slots:2,d:{Mon:[[m(5),m(18)]],Tue:[[m(5),m(18)]],Wed:[[m(5),m(18)]],Thu:[[m(5),m(18)]],Fri:[[m(5),m(18)]],Sat:[[m(5),m(18)]],Sun:[[m(5),m(18)]]}},
 SUP2:{name:"TGE depot",label:"Sort – TGE",net:"tge",novan:1,d:{Mon:[[m(6,30),m(8)]],Tue:[[m(6,30),m(8)]],Wed:[[m(6,30),m(8)]],Thu:[[m(6,30),m(8)]],Fri:[[m(6,30),m(8)]]}},   /* TGE sort 6:30–8:00, weekdays only */
 SUP3:{name:"NZP depot · West Harbour",label:"Sort – West Harbour",net:"nzp",novan:1,slots:2,d:{Mon:[[m(5),m(8)]],Tue:[[m(5),m(8)]],Wed:[[m(5),m(8)]],Thu:[[m(5),m(8)]],Fri:[[m(5),m(8)]],Sat:[[m(5),m(8)]]}},
 FB:{name:"Food bag · am shift",label:"Food bag 1 AM",net:"sun",fixed:1,slim:1,d:{Sun:[[m(11),m(14)]]}},
 FBP:{name:"Food bag · pm shift",label:"Food bag 1 PM",net:"sun",fixed:1,slim:1,d:{Sun:[[m(14),m(17)]]}},
 FB2:{name:"Food bag · am shift",label:"Food bag 2 AM",net:"sun",fixed:1,slim:1,d:{Sun:[[m(11),m(14)]]}},
 FB2P:{name:"Food bag · pm shift",label:"Food bag 2 PM",net:"sun",fixed:1,slim:1,d:{Sun:[[m(14),m(17)]]}},
 MFB1:{name:"MFB 1",net:"sun",d:{Sun:[[m(10),m(16)]]}},
 MFB2:{name:"MFB 2",net:"sun",d:{Sun:[[m(10),m(16)]]}}
};
var ORDER=["TUA","DB","FLY","LAW","RAM","PCB","RSB","S","T","FB","FBP","FB2","FB2P","SUP","SUP3","SUP2","BU"];
/* Saturday: PCB and RSB now go out as two separate rounds (split Oct 2026) — COMBINED is switched off by pointing it at no day */
var COMBINED={day:"none",top:"PCB",under:"RSB",label:"PCB + RSB combined"};

var PRESET={
 /* Dan's slots from the 24 Aug pattern are deliberately left blank — he's out of the pool */
 "Mon|FLY":"A","Mon|TUA":"CB","Mon|RAM":"G","Mon|LAW":"JA","Mon|S":"SJ",
 "Tue|PCB":"CB","Tue|TUA":"N","Tue|LAW":"JA","Tue|S":"G","Tue|T":"SJ",
 "Wed|FLY":"A","Wed|RAM":"N","Wed|LAW":"JA","Wed|S":"SJ","Wed|T":"G",
 "Thu|RSB":"N","Thu|PCB":"CB","Thu|LAW":"JA","Thu|S":"SJ","Thu|T":"G",
 "Fri|FLY":"A","Fri|TUA":"N","Fri|LAW":"JA","Fri|S":"G","Fri|T":"CB",
 "Sat|PCB":"N"
};

var FLEET_V=4;
var COLOURS={white:"#f1f1ee",blue:"#2a6fd0",silver:"#b8bdc5",grey:"#7c828b",red:"#c33630",yellow:"#e7b422",green:"#2e7d4f",black:"#31363d"};
var DEFAULT_VANS=[
 {id:"ncc200",plate:"NCC720",col:"white",type:"van",make:"Toyota Hiace (big)"},
 {id:"qyc234",plate:"QYC234",col:"blue",type:"van",make:"Toyota Hiace"},
 {id:"kal870",plate:"KAL870",col:"blue",type:"van",make:"Toyota Hiace"},
 {id:"mbk700",plate:"MBK700",col:"white",type:"van",make:"Nissan"},
 {id:"mjk872",plate:"MJK872",col:"silver",type:"van",make:"Renault"},
 {id:"phz879",plate:"PHZ879",col:"red",type:"van",make:"Nissan X-Trail"},
 {id:"jqy940",plate:"JQY940",col:"white",type:"van",make:"Toyota Hiace"}
];
/* standing allocations: the van that lives on a run every week */
var FIXED_VAN={T:"mjk872"};
function seedFixed(assign){
  Object.keys(FIXED_VAN).forEach(function(run){
    DAYS.forEach(function(day){
      if(!win(run,day))return;
      var k=day+"|"+run,o=assign[k];if(typeof o==="string")o={drv:o};o=o||{};
      if(!o.van){o.van=FIXED_VAN[run];assign[k]=o;}
    });
  });
  Object.keys(DEFAULT_ADD).forEach(function(run){
    DAYS.forEach(function(day){
      if(!win(run,day))return;
      var k=day+"|"+run,o=assign[k];if(typeof o==="string")o={drv:o};o=o||{};
      var L=(o.add||[]).slice();
      DEFAULT_ADD[run].forEach(function(id){
        var elsewhere=WAIHOLA_RUNS.some(function(r){var x=assign[day+"|"+r];return r!==run&&x&&x.add&&x.add.indexOf(id)>=0;});
        if(L.indexOf(id)<0&&!elsewhere)L.push(id);
      });
      if(L.length){o.add=L;assign[k]=o;}
    });
  });
  return assign;
}
function freshFleet(){return DEFAULT_VANS.map(function(v){return {id:v.id,plate:v.plate,col:v.col,type:v.type,make:v.make};});}

/* ---------- van symbol ---------- */
var BODY={van:"M6 9 H64 L78 20 H94 a3 3 0 0 1 3 3 V32 a2 2 0 0 1-2 2 H6 a3 3 0 0 1-3-3 V12 a3 3 0 0 1 3-3 Z"};
var GLASS={van:"M66 11 L77 20 H66 Z"};
function vanSVG(v,w,showPlate){
  var fill=COLOURS[v.col]||COLOURS.silver, t="van";
  var plate = showPlate
    ? '<rect x="14" y="17" width="40" height="12" rx="2" fill="#f7f7f4" stroke="#20242b" stroke-width="1"/>'+
      '<text x="34" y="26" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="8.6" font-weight="600" fill="#20242b">'+esc(v.plate)+'</text>'
    : '';
  return '<svg viewBox="0 0 100 42" width="'+w+'" role="img" aria-label="'+esc(v.plate)+'" draggable="false">'+
    '<path d="'+BODY[t]+'" fill="'+fill+'" stroke="#20242b" stroke-width="1.6" stroke-linejoin="round"/>'+
    '<path d="'+GLASS[t]+'" fill="var(--glass)" stroke="#20242b" stroke-width="1.1" stroke-linejoin="round"/>'+
    plate+
    '<circle cx="26" cy="34" r="6.4" fill="#20242b"/><circle cx="26" cy="34" r="2.4" fill="'+fill+'"/>'+
    '<circle cx="79" cy="34" r="6.4" fill="#20242b"/><circle cx="79" cy="34" r="2.4" fill="'+fill+'"/>'+
    '</svg>';
}

/* ---------- week keys ---------- */
function monday(d){var x=new Date(d);var w=(x.getDay()+6)%7;x.setDate(x.getDate()-w);x.setHours(0,0,0,0);return x;}
function key(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
function curMon(){var d=new Date();if(d.getDay()===0)d.setDate(d.getDate()+1);return monday(d);}
function addDays(d,n){var x=new Date(d);x.setDate(x.getDate()+n);return x;}
var MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function short(d){return d.getDate()+" "+MON[d.getMonth()];}

var state={mon:curMon(),cfg:{drivers:DEFAULT_DRIVERS.map(function(d){return {id:d.id,name:d.name,cleared:!!d.cleared};}),vans:freshFleet(),fleetV:FLEET_V},data:{assign:{}},pick:null,editFleet:false,editDrivers:false};
(function(){try{var r=localStorage.getItem("taieri-roster-cfg");if(r){var c=JSON.parse(r);if(c&&c.drivers&&c.drivers.length)state.cfg.drivers=c.drivers;if(c&&c.fleetV===FLEET_V&&c.vans&&c.vans.length)state.cfg.vans=c.vans;if(c&&c.win)state.cfg.win=c.win;if(c&&c.avail)state.cfg.avail=c.avail;if(c&&c.train)state.cfg.train=c.train;if(c&&c.skills)state.cfg.skills=c.skills;}}catch(e){}})();
rebuildIndex();

/* ---------- storage ---------- */
var STAFF=false,LEAVE=[],DB=null,docRef=null,unsub=null,saveT=null,pending=0,lastLocal=0,cfgRef=null,cfgT=null,cfgPending=0;
var cfgLocal=(function(){try{var r=localStorage.getItem("taieri-roster-cfg");if(r)return JSON.parse(r).updated||0;}catch(e){}return 0;})();
function docId(){return "roster/"+key(state.mon);}
function lsKey(){return "taieri-roster-"+key(state.mon);}
function saveLocal(){try{localStorage.setItem(lsKey(),JSON.stringify(state.data));}catch(e){}}
function setStatus(t,good){var el=document.getElementById("status");el.innerHTML=good?"<b>"+t+"</b>":t;}
function clone(x){try{return JSON.parse(JSON.stringify(x));}catch(e){return x;}}
function adopt(v){
  v=clone(v);
  var ids={};state.cfg.vans.forEach(function(x){ids[x.id]=1;});
  var asg=(v&&v.assign)||{};
  Object.keys(asg).forEach(function(k){
    var o=asg[k];if(typeof o==="string")o={drv:o};
    /* unknown driver or van ids are kept — the setup may simply not have synced yet */
    var kd=k.split("|");if(!W[kd[1]]){delete asg[k];return;}
    if(o.add){o.add=o.add.filter(function(x){return (ADDON[x]||/^tw_/.test(x))&&!satBlocked(kd[0],x);});if(!o.add.length)delete o.add;}
    if(!anyDrv(o)&&!o.van&&!o.add&&!o.tr)delete asg[k];else asg[k]=o;
  });
  return {assign:asg,notes:(v&&typeof v.notes==="string")?v.notes:""};
}
function removeDriver(id){
  state.cfg.drivers=state.cfg.drivers.filter(function(x){return x.id!==id;});
  Object.keys(state.data.assign).forEach(function(k){var o=norm(state.data.assign[k]);var hit=false;if(o.drv===id){delete o.drv;hit=true;}XD.forEach(function(f){if(o[f]===id){delete o[f];hit=true;}});if(o.tr===id){delete o.tr;hit=true;}if(hit){if(!o.van&&!o.add&&!anyDrv(o)&&!o.tr)delete state.data.assign[k];else state.data.assign[k]=o;}});
  saveCfg();render();
}
function removeVan(id){
  state.cfg.vans=state.cfg.vans.filter(function(x){return x.id!==id;});
  Object.keys(state.data.assign).forEach(function(k){var o=norm(state.data.assign[k]);if(o.van===id){delete o.van;if(!anyDrv(o)&&!o.add&&!o.tr)delete state.data.assign[k];else state.data.assign[k]=o;}});
  saveCfg();render();
}
function saveCfg(){
  autoSync();
  state.cfg.drivers=clone(state.cfg.drivers);state.cfg.vans=clone(state.cfg.vans);
  rebuildIndex();
  cfgLocal=Date.now();
  var doc={drivers:state.cfg.drivers,vans:state.cfg.vans,win:state.cfg.win||{},avail:state.cfg.avail||{},train:state.cfg.train||{},skills:state.cfg.skills||{},fleetV:FLEET_V,updated:cfgLocal};
  try{localStorage.setItem("taieri-roster-cfg",JSON.stringify(doc));}catch(e){}
  state.data=adopt(state.data);  /* drop assignments that point at people or vans that no longer exist */
  save();
  if(!cfgRef||STAFF)return;
  clearTimeout(cfgT);cfgPending++;
  var payload=clone(doc);
  setStatus("saving…");
  flushCfg=function(){
    clearTimeout(cfgT);flushCfg=null;
    cfgRef.set(payload).then(function(){setStatus("saved "+stamp(),true);})
      .catch(function(e){setStatus("NOT saved to the cloud — "+(e&&(e.message||e.code)||"write failed")+" · kept on this device");})
      .then(function(){cfgPending=0;});
  };
  cfgT=setTimeout(flushCfg,300);
}
var flushWeek=null,flushCfg=null;
function stamp(){var d=new Date();return d.toTimeString().slice(0,8);}
/* any change on the board: 15 seconds after the last edit, start the scorecard sync, which then refreshes the driver portals (29 Oct 2026) */
var AUTOSYNC_T=null;
function autoSync(){if(STAFF||typeof MCP==="undefined"||!MCP)return;clearTimeout(AUTOSYNC_T);AUTOSYNC_T=setTimeout(function(){try{fireSync().catch(function(){});}catch(e){}},15000);}
function save(){
  autoSync();
  lastLocal=Date.now();state.data.updated=lastLocal;
  saveLocal();
  if(!docRef||STAFF)return;
  clearTimeout(saveT);pending++;
  var ref=docRef,payload={assign:clone(state.data.assign),notes:state.data.notes||"",updated:lastLocal};
  setStatus("saving…");
  flushWeek=function(){
    clearTimeout(saveT);flushWeek=null;
    ref.set(payload)
      .then(function(){if(ref===docRef)setStatus("saved "+stamp(),true);})
      .catch(function(e){setStatus("NOT saved to the cloud — "+(e&&(e.message||e.code)||"write failed")+" · kept on this device");})
      .then(function(){pending=0;});
  };
  saveT=setTimeout(flushWeek,300);
}
function flushAll(){if(flushWeek)flushWeek();if(flushCfg)flushCfg();}
window.addEventListener("pagehide",flushAll);
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden")flushAll();});
function openWeek(){
  try{saveView();}catch(e){}
  flushAll();                                        /* anything still queued for the week we're leaving goes up now */
  if(unsub){try{unsub();}catch(e){}unsub=null;}
  var local=null;try{var r=localStorage.getItem(lsKey());if(r)local=JSON.parse(r);}catch(e){}
  state.data=adopt(local);state.pick=null;docRef=null;
  lastLocal=(local&&local.updated)||0;               /* what this device last saved for this week */
  state.data.updated=lastLocal;
  if(!local)seedFixed(state.data.assign);
  render();
  if(!DB)return;
  docRef=DB.doc(docId());
  watchAppr();
  var gotServer=false;
  try{
    unsub=docRef.onSnapshot(function(snap){
      var v=snap&&(snap.data?snap.data():snap);
      if(!v||!v.assign){
        if(!gotServer&&local&&local.assign&&Object.keys(local.assign).length){gotServer=true;save();}   /* nothing in the cloud yet: push this device's copy */
        return;
      }
      gotServer=true;
      if(pending||drag)return;                       /* a local edit is on its way up — don't clobber it */
      if((v.updated||0)<lastLocal){save();return;}   /* this device is newer than the cloud: push, don't pull */
      state.data=adopt(v);state.data.updated=v.updated||0;lastLocal=state.data.updated;saveLocal();render();setStatus("saved "+stamp(),true);
    });
  }catch(e){}
}
(function(){
  if(!window.claude||!window.claude.use)return;
  window.claude.use("db").then(function(db){
    if(!db)return;DB=db;setStatus("syncing…");
    cfgRef=DB.doc("settings/roster");
    try{DB.doc("settings/timing").onSnapshot(function(snap){var v=snap&&(snap.data?snap.data():snap);if(!v||!v.rules)return;v=clone(v);try{localStorage.setItem("taieri-timing",JSON.stringify({rules:v.rules}));}catch(e){}twApply(v.rules);if(!drag)render();},function(){});}catch(e){}
    try{
      var gotCfg=false;
      cfgRef.onSnapshot(function(snap){
        var v=snap&&(snap.data?snap.data():snap);
        if(!v||!v.drivers){if(!gotCfg&&cfgLocal){gotCfg=true;saveCfg();}return;}   /* nothing in the cloud yet: push this device's setup */
        gotCfg=true;
        if(cfgPending||drag)return;
        if((v.updated||0)<cfgLocal){saveCfg();return;}                           /* this device is newer: push, don't pull */
        v=clone(v);
        state.cfg.drivers=v.drivers;
        if(v.fleetV===FLEET_V&&v.vans&&v.vans.length)state.cfg.vans=v.vans;
        state.cfg.win=v.win||{};state.cfg.avail=v.avail||{};state.cfg.train=v.train||{};state.cfg.skills=v.skills||{};
        rebuildIndex();
        try{localStorage.setItem("taieri-roster-cfg",JSON.stringify(v));}catch(e){}
        state.data=adopt(state.data);render();
      });
    }catch(e){}
    openWeek();
  }).catch(function(){});
})();

/* ---------- model ---------- */
function slots(day){return ORDER.filter(function(r){return win(r,day);});}
function win(run,day){
  var o=state.cfg.win&&state.cfg.win[day+"|"+run];
  if(o===null)return null;                 /* switched off for that day */
  if(o&&o.length)return o;                 /* custom timing */
  return W[run].d[day]||null;              /* the operations-document default */
}
function defWin(run,day){return W[run].d[day]||null;}
/* run experience: which driver is signed off ("yes") or in training ("tr") on which run; the AM/PM food bag rows and Saturday combined share one skill */
var SKILL_RUNS=["TUA","DB","FLY","LAW","RAM","PCB","RSB","S","T","FB"];
var SKILL_OF={WH:"PCB",FBP:"FB",FB2:"FB",FB2P:"FB"};
function skillRun(run){var s=SKILL_OF[run]||run;return SKILL_RUNS.indexOf(s)>=0?s:null;}
function skillOf(drv,run){var s=skillRun(run);if(!s)return "yes";return (state.cfg.skills||{})[drv+"|"+s]||"";}
function cycleSkill(drv,s){state.cfg.skills=state.cfg.skills||{};var k=drv+"|"+s,c=state.cfg.skills[k]||"";var n=c===""?"yes":(c==="yes"?"tr":"");if(n)state.cfg.skills[k]=n;else delete state.cfg.skills[k];saveCfg();render();}
function isTrain(day,run){return !!(state.cfg.train&&state.cfg.train[day+"|"+run]);}
function setTrain(day,run,on){state.cfg.train=state.cfg.train||{};if(on)state.cfg.train[day+"|"+run]=true;else delete state.cfg.train[day+"|"+run];saveCfg();render();}
function baseAvail(drv,day){
  var o=state.cfg.avail&&state.cfg.avail[day+"|"+drv];
  if(o===null)return null;            /* not available that day */
  if(o&&o.length===2)return o;        /* custom window */
  return [A0,A1];                     /* default: the whole working day */
}
/* approved leave for this driver on this date of the week on screen */
function leaveOn(drv,day){
  var d=key(addDays(state.mon,DAYS.indexOf(day)));
  for(var i=0;i<LEAVE.length;i++){var rs=LEAVE[i].requests||[];for(var j=0;j<rs.length;j++){var r=rs[j];if(r.status==="approved"&&r.driver===drv&&r.from<=d&&r.to>=d)return r;}}
  return null;
}
function availOf(drv,day){
  var b=baseAvail(drv,day);if(!b)return null;
  var lv=leaveOn(drv,day);if(!lv)return b;
  if(lv.part==="AM"){var s=Math.max(b[0],12*60);return s<b[1]?[s,b[1]]:null;}
  if(lv.part==="PM"){var e=Math.min(b[1],12*60);return e>b[0]?[b[0],e]:null;}
  return null;
}
function naTxt(id,day){var lv=leaveOn(id,day);return lv?" is on "+ltLabel(lv.type).toLowerCase()+" on "+day+(lv.part!=="full"?" ("+(lv.part==="AM"?"morning":"afternoon")+" off)":"")+".":" is marked not available on "+day+".";}
function setAvail(day,drv,s0,e0){state.cfg.avail=state.cfg.avail||{};state.cfg.avail[day+"|"+drv]=(s0===null)?null:[s0,e0];saveCfg();render();}
function resetAvail(day,drv){if(state.cfg.avail)delete state.cfg.avail[day+"|"+drv];saveCfg();render();}
function setWin(day,run,s0,e0){
  if(e0<=s0)return;
  var d=defWin(run,day),segs;
  if(d&&d.length===2&&s0<d[0][1]&&e0>d[1][0])segs=[[s0,d[0][1]],[d[1][0],e0]];   /* keep the split-shift break */
  else segs=[[s0,e0]];
  state.cfg.win=state.cfg.win||{};state.cfg.win[day+"|"+run]=segs;saveCfg();render();
}
function setOff(day,run,off){
  state.cfg.win=state.cfg.win||{};
  if(off)state.cfg.win[day+"|"+run]=null;else delete state.cfg.win[day+"|"+run];
  saveCfg();render();
}
function resetWin(day,run){if(state.cfg.win){delete state.cfg.win[day+"|"+run];}saveCfg();render();}
function dur(run,day){var w=win(run,day);if(!w)return 0;var t=0;w.forEach(function(s){t+=s[1]-s[0];});return t;}
function span(run,day){var w=win(run,day);return w?[w[0][0],w[w.length-1][1]]:null;}
function fmtS(v){var h=Math.floor(v/60),x=v%60;return h+(x?":"+(x<10?"0":"")+x:"");}
function winShort(run,day){var w=win(run,day);return w?w.map(function(s){return fmtS(s[0])+"–"+fmtS(s[1]);}).join(" + "):"";}
function winText(run,day){var w=win(run,day);return w?w.map(function(s){return fmt(s[0])+"–"+fmt(s[1]);}).join(" + "):"";}
function norm(a){return typeof a==="string"?{drv:a}:(a||{});}
function RL(run){return W[run]&&W[run].label?W[run].label:run;}
function extraMin(day,run){var a=get(day,run),t=0;(a.add||[]).forEach(function(id){if(ADDON[id])t+=ADDON[id].min;});return t;}
function espan(run,day){var sp=span(run,day);if(!sp)return null;return [sp[0],sp[1]+extraMin(day,run)];}
function edur(run,day){return dur(run,day)+extraMin(day,run);}
function extraText(day,run){var x=extraMin(day,run);if(!x)return "";var h=Math.floor(x/60),m=x%60;return " +"+(h?h+"h":"")+(m?(h?String(m).padStart(2,"0"):m+"m"):"");}
function get(day,run){return norm(state.data.assign[day+"|"+run]);}
function vanOf(id){var r=null;state.cfg.vans.forEach(function(v){if(v.id===id)r=v;});return r;}
function plateOf(id){var v=vanOf(id);return v?v.plate:String(id).toUpperCase();}
function setA(day,run,field,val){
  var k=day+"|"+run,cur=get(day,run);
  cur=Object.assign({},cur);
  if(val)cur[field]=val;else delete cur[field];
  if(cur.add&&!cur.add.length)delete cur.add;
  ["drv","drv2","drv3","drv4","van","tr"].forEach(function(f){if(!cur[f]){delete cur[f];if(f.indexOf("drv")===0)delete cur[stKey(f)];}});
  if(!anyDrv(cur)&&!cur.van&&!cur.add&&!cur.tr)delete state.data.assign[k];else state.data.assign[k]=cur;
  save();render();
}
/* which stored field a slot writes to: driver slot -> drv, trainee slot -> tr, van slot -> van */
var XD=["drv2","drv3","drv4"];
function stKey(f){return "st"+f.slice(3);}   /* drv -> st, drv2 -> st2 ... (support start hour, 5..11) */
var ST_MIN=5,ST_MAX=11;
function fmtSt(v){var h=Math.floor(v),x=Math.round((v-h)*60);return h+(x?":"+(x<10?"0":"")+x:"");}   /* 10.5 -> "10:30" */
function anyDrv(o){return !!(o.drv||o.drv2||o.drv3||o.drv4);}
function fieldOf(kind,role){if(kind==="van")return "van";if(role==="tr")return "tr";var m=/^d([234])$/.exec(role||"");return m?"drv"+m[1]:"drv";}
function roleOf(f){if(f==="tr")return "tr";var m=/^drv([234])$/.exec(f||"");return m?"d"+m[1]:undefined;}
function toggleAdd(day,run,id,on){
  if(on&&satBlocked(day,id)){hint("No receivers or pick-ups on Saturdays",2600);return;}
  if(on&&!twAllowed(day,run,id)){var tr=TWBY[id];hint((ADDON[id]?ADDON[id].name:"That timing")+" is only for "+(tr?twWhere(tr):"its own runs"),3200);return;}
  var cur=get(day,run),list=(cur.add||[]).filter(function(x){return x!==id&&(ADDON[x]||/^tw_/.test(x));});
  if(on)list.push(id);
  list.sort(function(a,b){return ADDONS.findIndex(function(x){return x.id===a;})-ADDONS.findIndex(function(x){return x.id===b;});});
  setA(day,run,"add",list.length?list:null);
}

/* cross-over runs: Flyer and D>B go out together on the same trip, so the same driver and van on both is not a clash */
var CROSS=[["FLY","DB"]];
function isPair(a,b){return CROSS.some(function(c){return (c[0]===a&&c[1]===b)||(c[0]===b&&c[1]===a);});}
/* ---------- validation ---------- */
function analyse(){
  var issues=[],drvHrs={},drvRuns={},vanDays={},vanRuns={},drvTrain={};
  DAYS.forEach(function(day){
    var byDrv={},byVan={};
    slots(day).forEach(function(run){
      var a=get(day,run);
      if(a.tr){
        (byDrv[a.tr]=byDrv[a.tr]||[]).push(run);
        drvHrs[a.tr]=(drvHrs[a.tr]||0)+edur(run,day);drvTrain[a.tr]=(drvTrain[a.tr]||0)+1;
        var tav=availOf(a.tr,day),tsp=espan(run,day);
        if(!tav) issues.push({lv:"crit",k:day+"|"+run,t:day+" · "+RL(run),d:DNAME[a.tr]+" (trainee)"+naTxt(a.tr,day)});
        else if(tsp[0]<tav[0]||tsp[1]>tav[1]) issues.push({lv:"crit",k:day+"|"+run,t:day+" · "+RL(run),d:DNAME[a.tr]+" (trainee) is only available "+fmt(tav[0])+"–"+fmt(tav[1])+" but "+RL(run)+" runs "+fmt(tsp[0])+"–"+fmt(tsp[1])+"."});
        if(a.tr===a.drv) issues.push({lv:"crit",k:day+"|"+run,t:day+" · "+RL(run),d:DNAME[a.tr]+" is down as both driver and trainee on "+RL(run)+"."});
        if(!a.drv) issues.push({lv:"warn",k:day+"|"+run,t:day+" · "+RL(run),d:DNAME[a.tr]+" is a trainee on "+RL(run)+" with no driver to train them."});
      }
      if(a.drv){
        (byDrv[a.drv]=byDrv[a.drv]||[]).push(run);
        drvHrs[a.drv]=(drvHrs[a.drv]||0)+edur(run,day);
        if(isTrain(day,run))drvTrain[a.drv]=(drvTrain[a.drv]||0)+1;else drvRuns[a.drv]=(drvRuns[a.drv]||0)+1;
        var av=availOf(a.drv,day),rsp=espan(run,day);
        if(!av) issues.push({lv:"crit",k:day+"|"+run,t:day+" · "+RL(run),d:DNAME[a.drv]+naTxt(a.drv,day)});
        else if(rsp[0]<av[0]||rsp[1]>av[1]) issues.push({lv:"crit",k:day+"|"+run,t:day+" · "+RL(run),d:DNAME[a.drv]+" is only available "+fmt(av[0])+"–"+fmt(av[1])+" but "+RL(run)+" runs "+fmt(rsp[0])+"–"+fmt(rsp[1])+"."});
        var skv=skillOf(a.drv,run);
        if(skv!=="yes")
          issues.push({lv:"warn",k:day+"|"+run,t:day+" · "+RL(run),d:DNAME[a.drv]+(skv==="tr"?" is still training on ":" hasn't been signed off on ")+RL(run)+" (see Run experience)."});
      }
      var seen={};if(a.drv)seen[a.drv]=1;
      XD.forEach(function(f){var x=a[f];if(!x)return;
        (byDrv[x]=byDrv[x]||[]).push(run);
        drvHrs[x]=(drvHrs[x]||0)+edur(run,day);
        if(isTrain(day,run))drvTrain[x]=(drvTrain[x]||0)+1;else drvRuns[x]=(drvRuns[x]||0)+1;
        var av2=availOf(x,day),rsp2=espan(run,day);
        if(!av2) issues.push({lv:"crit",k:day+"|"+run,t:day+" · "+RL(run),d:DNAME[x]+naTxt(x,day)});
        else if(rsp2[0]<av2[0]||rsp2[1]>av2[1]) issues.push({lv:"crit",k:day+"|"+run,t:day+" · "+RL(run),d:DNAME[x]+" is only available "+fmt(av2[0])+"–"+fmt(av2[1])+" but "+RL(run)+" runs "+fmt(rsp2[0])+"–"+fmt(rsp2[1])+"."});
        if(seen[x]) issues.push({lv:"crit",k:day+"|"+run,t:day+" · "+RL(run),d:DNAME[x]+" is down twice on "+RL(run)+"."});
        seen[x]=1;
      });
      if(a.van){(byVan[a.van]=byVan[a.van]||[]).push(run);(vanDays[a.van]=vanDays[a.van]||{})[day]=1;vanRuns[a.van]=(vanRuns[a.van]||0)+1;}
      if(a.drv&&!a.van&&!W[run].novan) issues.push({lv:"warn",k:day+"|"+run,t:day+" · "+RL(run),d:DNAME[a.drv]+" has no vehicle."});
      if(a.van&&!a.drv) issues.push({lv:"warn",k:day+"|"+run,t:day+" · "+RL(run),d:plateOf(a.van)+" is allocated with no driver."});
    });
    Object.keys(byDrv).forEach(function(dv){
      var rs=byDrv[dv].slice().sort(function(a,b){return espan(a,day)[0]-espan(b,day)[0];});
      var hard=rs.filter(function(r){var g=get(day,r);return W[r].hard&&(g.drv===dv||g.drv2===dv||g.drv3===dv||g.drv4===dv);});
      if(hard.length>1) issues.push({lv:"warn",k:day+"|"+hard[1],t:day+" · hard-run rule",d:DNAME[dv]+" has "+hard.map(RL).join(" and ")+" on one day. The operations document sets the limit at one."});
      for(var i=1;i<rs.length;i++){
        if(isPair(rs[i-1],rs[i]))continue;            /* Flyer and D>B are one cross-over trip */
        if(W[rs[i-1]].novan||W[rs[i]].novan)continue; /* Support / Back up = where you start and who's on call, not a clash */
        var p=espan(rs[i-1],day),n=espan(rs[i],day),gap=n[0]-p[1];
        if(gap<0) issues.push({lv:"crit",k:day+"|"+rs[i],t:day+" · double-booked",d:DNAME[dv]+" is on "+RL(rs[i-1])+" ("+fmt(p[0])+"–"+fmt(p[1])+") and "+RL(rs[i])+" ("+fmt(n[0])+"–"+fmt(n[1])+") at the same time."});
        else if(gap===0) issues.push({lv:"warn",k:day+"|"+rs[i],t:day+" · no handover",d:DNAME[dv]+" finishes "+RL(rs[i-1])+" at "+fmt(p[1])+" and starts "+RL(rs[i])+" the same minute — no travel time between them."});
        else if(gap<30) issues.push({lv:"warn",k:day+"|"+rs[i],t:day+" · tight",d:DNAME[dv]+" has "+gap+" min between "+RL(rs[i-1])+" and "+RL(rs[i])+"."});
      }
    });
    Object.keys(byVan).forEach(function(vn){
      var rs=byVan[vn].slice().sort(function(a,b){return espan(a,day)[0]-espan(b,day)[0];});
      for(var i=1;i<rs.length;i++){
        if(isPair(rs[i-1],rs[i]))continue;
        var p=espan(rs[i-1],day),n=espan(rs[i],day);
        if(n[0]<p[1]) issues.push({lv:"crit",k:day+"|"+rs[i],t:day+" · vehicle double-booked",d:plateOf(vn)+" is on "+RL(rs[i-1])+" ("+fmt(p[0])+"–"+fmt(p[1])+") and "+RL(rs[i])+" ("+fmt(n[0])+"–"+fmt(n[1])+") at the same time."});
      }
    });
  });
  /* Waihola Store: one run each day (normally the Flyer, or TUA / D>B) */
  DAYS.forEach(function(day){
    var on=WAIHOLA_RUNS.filter(function(r){return win(r,day);});if(!on.length)return;
    if(!on.some(function(r){return anyDrv(get(day,r));}))return;
    var has=on.filter(function(r){return (get(day,r).add||[]).indexOf("waihola")>=0;});
    if(!has.length)issues.push({lv:"warn",k:day+"|"+on[0],t:day+" · Waihola Store",d:"Nobody has the Waihola Store stop. It normally goes on the Flyer (or TUA / D>B)."});
    else if(has.length>1)issues.push({lv:"warn",k:day+"|"+has[1],t:day+" · Waihola Store",d:"Waihola Store is on "+has.map(RL).join(" and ")+". One run is enough."});
  });
  /* timing rules for several runs: ticked on exactly one of them each day it applies */
  TW.forEach(function(r){var runs=twRunsOf(r),aid=twAidOf(r);if(runs.length<2||aid==="waihola")return;
    DAYS.forEach(function(day,di){if((r.days||[]).indexOf(di)<0)return;
      var go=runs.filter(function(c){return W[c]&&win(c,day)&&anyDrv(get(day,c));});if(!go.length)return;
      var has=runs.filter(function(c){return W[c]&&win(c,day)&&(get(day,c).add||[]).indexOf(aid)>=0;});
      if(!has.length)issues.push({lv:"warn",k:day+"|"+go[0],t:day+" · "+r.name,d:"Nobody has this timing. Tick it on the run that does it ("+runs.map(RL).join(" / ")+")."});
      else if(has.length>1)issues.push({lv:"warn",k:day+"|"+has[1],t:day+" · "+r.name,d:"Ticked on "+has.map(RL).join(" and ")+". Only one run should have it."});});});
  issues.sort(function(a,b){return (a.lv==="crit"?0:1)-(b.lv==="crit"?0:1);});
  return {issues:issues,drvHrs:drvHrs,drvRuns:drvRuns,drvTrain:drvTrain,vanDays:vanDays,vanRuns:vanRuns};
}
function peakVehicles(day){
  var sp=[];
  slots(day).forEach(function(run){if(W[run].novan)return;var a=get(day,run);if(a.drv||a.van)sp.push(espan(run,day));});
  var peak=0;
  for(var t=4*60;t<=18*60;t+=15){var n=0;sp.forEach(function(s){if(t>=s[0]&&t<s[1])n++;});if(n>peak)peak=n;}
  return peak;
}

/* ---------- pointer drag ---------- */
var ghost=document.getElementById("ghost"),hintEl=document.getElementById("hint");
var drag=null;
function hint(msg,ms){
  if(!msg){hintEl.hidden=true;return;}
  hintEl.textContent=msg;hintEl.hidden=false;
  if(ms){clearTimeout(hint._t);hint._t=setTimeout(function(){hintEl.hidden=true;},ms);}
}
function ghostHTML(kind,id){
  if(kind==="driver")return '<div class="chip" style="cursor:grabbing">'+esc(DNAME[id])+'</div>';
  if(kind==="addon")return '<div class="chip addon" style="cursor:grabbing">'+esc(ADDON[id].name)+'</div>';
  var v=vanOf(id);return v?'<div class="vcard" style="cursor:grabbing;background:var(--surface)">'+vanSVG(v,96,true)+'</div>':'';
}
function startDrag(kind,id,from,ev,el){
  if(ev.button!==undefined&&ev.button>0)return;
  if(ev.pointerType==="mouse"&&ev.buttons!==undefined&&!(ev.buttons&1))return;
  drag={kind:kind,id:id,from:from,x0:ev.clientX,y0:ev.clientY,moved:false,el:el,pid:ev.pointerId};
  try{el.setPointerCapture(ev.pointerId);}catch(e){}
  ev.preventDefault();
}
function moveGhost(ev){var z=parseFloat(ghost.style.zoom)||1;if(ZOOM_OK){ghost.style.left=(ev.clientX/z)+"px";ghost.style.top=(ev.clientY/z)+"px";}else{ghost.style.left=ev.clientX+"px";ghost.style.top=ev.clientY+"px";}}
function targetAt(ev){
  var el=document.elementFromPoint(ev.clientX,ev.clientY);
  while(el&&el!==document.body){
    if(drag.kind==="addon"){if(el.classList&&el.classList.contains("cell")&&!el.classList.contains("off"))return el;}
    else if(el.classList&&el.classList.contains("slot")&&el.dataset.kind===drag.kind)return el;
    el=el.parentNode;
  }
  return null;
}
document.addEventListener("pointermove",function(ev){
  if(!drag)return;
  if(!drag.moved){
    if(Math.abs(ev.clientX-drag.x0)<5&&Math.abs(ev.clientY-drag.y0)<5)return;
    drag.moved=true;
    ghost.innerHTML=ghostHTML(drag.kind,drag.id);ghost.hidden=false;
    drag.el.classList.add("lifting");
    hint(null);
  }
  ev.preventDefault();
  moveGhost(ev);
  var t=targetAt(ev);
  document.querySelectorAll(".slot.hot,.cell.hot").forEach(function(n){if(n!==t)n.classList.remove("hot");});
  if(t)t.classList.add("hot");
},{passive:false});
document.addEventListener("pointerup",function(ev){
  if(!drag)return;
  var d=drag;drag=null;
  ghost.hidden=true;
  try{d.el.releasePointerCapture(d.pid);}catch(e){}
  d.el.classList.remove("lifting","armed");
  document.querySelectorAll(".slot.hot,.cell.hot").forEach(function(n){n.classList.remove("hot");});
  if(d.moved){
    drag=d; var t=targetAt(ev); drag=null;
    if(t)place(d.kind,d.id,t.dataset.day,t.dataset.run,d.from,t.dataset.role);
    else if(d.from&&d.kind!=="addon"){var p=d.from.split("|");setA(p[0],p[1],p[2]||fieldOf(d.kind),null);}
  }else{
    tap(d);
  }
});
document.addEventListener("pointercancel",function(){
  if(!drag)return;ghost.hidden=true;drag.el.classList.remove("lifting","armed");
  document.querySelectorAll(".slot.hot,.cell.hot").forEach(function(n){n.classList.remove("hot");});drag=null;
});
function place(kind,id,day,run,from,role){
  if(kind==="addon"){state.pick=null;hint(null);toggleAdd(day,run,id,true);return;}
  var f=fieldOf(kind,role);
  if(from){var p=from.split("|");var pf=p[2]||fieldOf(kind);if(p[0]!==day||p[1]!==run||pf!==f)setA(p[0],p[1],pf,null);}
  state.pick=null;hint(null);
  setA(day,run,f,id);
}
function tap(d){
  if(d.from){
    var p=d.from.split("|");
    if(state.pick&&state.pick.kind===d.kind){place(d.kind,state.pick.id,p[0],p[1],null,roleOf(p[2]));return;}
    state.pick={kind:d.kind,id:d.id};
    render();return;
  }
  if(state.pick&&state.pick.kind===d.kind&&state.pick.id===d.id){state.pick=null;hint(null);render();return;}
  state.pick={kind:d.kind,id:d.id};
  render();
}
function onTap(el,fn){
  if(!el)return;
  var last=0;
  function go(ev){var now=Date.now();if(now-last<500)return;last=now;fn(ev);}
  el.addEventListener("click",go);
  el.addEventListener("pointerup",function(ev){if(ev.button!==undefined&&ev.button>0)return;go(ev);});
}
var menuEl=document.getElementById("menu"),menuReopen=null;
function openMenu(anchor,day,run){
  var cur=get(day,run).add||[];
  menuReopen=function(){var a=document.querySelector('.slot.a[data-day="'+day+'"][data-run="'+run+'"]');if(a)openMenu(a,day,run);else closeMenu();};
  menuEl.innerHTML="";
  ADDONS.forEach(function(a){
    var on=cur.indexOf(a.id)>=0;
    if(!on&&satBlocked(day,a.id))return;
    if(!on&&!twAllowed(day,run,a.id))return;
    var mi=document.createElement("div");mi.className="mi"+(on?" on":"");
    mi.innerHTML='<span class="tick">'+(on?"✓":"")+'</span><span>'+esc(a.name)+'</span><span class="meta">'+esc(addMeta(a))+(TWBY[a.id]?" · timing":"")+'</span>';
    mi.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
    mi.addEventListener("click",function(ev){ev.stopPropagation();toggleAdd(day,run,a.id,!on);openMenu(document.querySelector('.slot.a[data-day="'+day+'"][data-run="'+run+'"]')||anchor,day,run);});
    menuEl.appendChild(mi);
  });
  menuEl.hidden=false;
  var r=anchor.getBoundingClientRect(),mw=menuEl.offsetWidth,mh=menuEl.offsetHeight;
  var x=r.right+6,y=r.top-4;
  if(x+mw>window.innerWidth-8)x=r.left-mw-6;
  if(y+mh>window.innerHeight-8)y=window.innerHeight-mh-8;
  menuEl.style.left=Math.max(8,x)+"px";menuEl.style.top=Math.max(8,y)+"px";
}
function openTraineeMenu(anchor,day,run){
  var cur=get(day,run);
  menuEl.innerHTML="";
  var hd=document.createElement("div");hd.className="mi";hd.style.cursor="default";hd.style.color="var(--ink-3)";hd.innerHTML='<span>Trainee on '+esc(RL(run))+' '+day+'</span>';menuEl.appendChild(hd);
  state.cfg.drivers.forEach(function(d){
    var on=cur.tr===d.id;
    var mi=document.createElement("div");mi.className="mi"+(on?" on":"");
    mi.innerHTML='<span class="tick" style="border-color:var(--warn)'+(on?';background:var(--warn)':'')+'">'+(on?"✓":"")+'</span><span>'+esc(d.name)+'</span>'+(cur.drv===d.id?'<span class="meta">driver</span>':'');
    mi.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
    mi.addEventListener("click",function(ev){ev.stopPropagation();closeMenu();setA(day,run,"tr",on?null:d.id);});
    menuEl.appendChild(mi);
  });
  menuEl.hidden=false;
  var r=anchor.getBoundingClientRect(),mw=menuEl.offsetWidth,mh=menuEl.offsetHeight;
  var x=r.right+6,y=r.top-4;
  if(x+mw>window.innerWidth-8)x=r.left-mw-6;
  if(y+mh>window.innerHeight-8)y=window.innerHeight-mh-8;
  menuEl.style.left=Math.max(8,x)+"px";menuEl.style.top=Math.max(8,y)+"px";
}
function openPickMenu(anchor,kind,day,run,role){
  var f=fieldOf(kind,role),sel={};sel[day]=true;
  menuEl.innerHTML="";
  var hd=document.createElement("div");hd.className="mh";hd.textContent=(kind==="van"?"Van":(role==="tr"?"Trainee":(/^d[234]$/.test(role||"")?role.slice(1)+(role==="d2"?"nd":(role==="d3"?"rd":"th"))+" driver":"Driver")))+" for "+RL(run);menuEl.appendChild(hd);
  var days=document.createElement("div");days.className="days";
  var chips={};
  DAYS.forEach(function(d){
    var c=document.createElement("span");c.textContent=d;
    if(!win(run,d)){c.className="na";}
    else{c.className=sel[d]?"on":"";c.addEventListener("pointerdown",function(ev){ev.stopPropagation();});c.addEventListener("click",function(ev){ev.stopPropagation();sel[d]=!sel[d];c.className=sel[d]?"on":"";});}
    chips[d]=c;days.appendChild(c);
  });
  var all=document.createElement("span");all.textContent="all";all.title="Every day this run goes";
  all.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
  all.addEventListener("click",function(ev){ev.stopPropagation();var every=DAYS.filter(function(d){return win(run,d);}).every(function(d){return sel[d];});DAYS.forEach(function(d){if(win(run,d)){sel[d]=!every;chips[d].className=sel[d]?"on":"";}});});
  days.appendChild(all);menuEl.appendChild(days);
  var list=document.createElement("div");list.className="list";
  var cur=get(day,run)[f];
  var items=kind==="van"?state.cfg.vans.map(function(v){return {id:v.id,html:vanSVG(v,40,false)+'<span>'+esc(v.plate)+'</span>'};}):state.cfg.drivers.map(function(d){return {id:d.id,html:'<span>'+esc(d.name)+'</span>'+(role!=="tr"&&!W[run].novan?(function(){var s=skillOf(d.id,run);return s==="yes"?'<span class="meta">✓</span>':(s==="tr"?'<span class="meta">training</span>':'<span class="meta">not signed off</span>');})():'')};});
  items.forEach(function(it){
    var on=cur===it.id;
    var mi=document.createElement("div");mi.className="mi"+(on?" on":"");
    mi.innerHTML='<span class="tick">'+(on?"✓":"")+'</span>'+it.html;
    mi.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
    mi.addEventListener("click",function(ev){
      ev.stopPropagation();closeMenu();
      var picked=DAYS.filter(function(d){return sel[d]&&win(run,d);});if(!picked.length)picked=[day];
      picked.forEach(function(d){var k=d+"|"+run,c=get(d,run);c=Object.assign({},c);if(on&&d===day)delete c[f];else c[f]=it.id;["drv","drv2","drv3","drv4","van","tr"].forEach(function(q){if(!c[q]){delete c[q];if(q.indexOf("drv")===0)delete c[stKey(q)];}});if(c.add&&!c.add.length)delete c.add;if(!anyDrv(c)&&!c.van&&!c.add&&!c.tr)delete state.data.assign[k];else state.data.assign[k]=c;});
      save();render();
    });
    list.appendChild(mi);
  });
  menuEl.appendChild(list);
  menuEl.hidden=false;
  var r=anchor.getBoundingClientRect(),mw=menuEl.offsetWidth,mh=menuEl.offsetHeight;
  var x=r.left,y=r.bottom+4;
  if(x+mw>window.innerWidth-8)x=window.innerWidth-mw-8;
  if(y+mh>window.innerHeight-8)y=r.top-mh-4;
  menuEl.style.left=Math.max(8,x)+"px";menuEl.style.top=Math.max(8,y)+"px";
}
function openTimeMenu(anchor,day,run){
  var w=win(run,day),s0=w?w[0][0]:6*60,e0=w?w[w.length-1][1]:10*60,sel={};sel[day]=true;
  menuEl.innerHTML="";
  var hd=document.createElement("div");hd.className="mh";hd.textContent=RL(run)+" \u2014 run time";menuEl.appendChild(hd);
  var days=document.createElement("div");days.className="days";var chips={};
  DAYS.forEach(function(d){
    var c=document.createElement("span");c.textContent=d;c.className=sel[d]?"on":"";
    c.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
    c.addEventListener("click",function(ev){ev.stopPropagation();sel[d]=!sel[d];c.className=sel[d]?"on":"";});
    chips[d]=c;days.appendChild(c);
  });
  var all=document.createElement("span");all.textContent="all";
  all.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
  all.addEventListener("click",function(ev){ev.stopPropagation();var every=DAYS.every(function(d){return sel[d];});DAYS.forEach(function(d){sel[d]=!every;chips[d].className=sel[d]?"on":"";});});
  days.appendChild(all);menuEl.appendChild(days);
  var tm=document.createElement("div");tm.className="tm";
  function tval(m){return fmt(m);}
  var si=document.createElement("input");si.type="time";si.step=900;si.value=tval(s0);si.id="tm-s-"+day+"-"+run;
  var ei=document.createElement("input");ei.type="time";ei.step=900;ei.value=tval(e0);ei.id="tm-e-"+day+"-"+run;
  var dash=document.createElement("span");dash.textContent="\u2013";
  var hrs=document.createElement("span");hrs.className="hrs";
  function parse(v){var m=/^(\d{1,2}):(\d{2})/.exec(v||"");return m?parseInt(m[1],10)*60+parseInt(m[2],10):null;}
  function upd(){var a=parse(si.value),b=parse(ei.value);hrs.textContent=(a!==null&&b!==null&&b>a)?hh(b-a)+"h":"\u2014";}
  [si,ei].forEach(function(i){i.addEventListener("pointerdown",function(ev){ev.stopPropagation();});i.addEventListener("input",upd);i.addEventListener("keydown",function(ev){if(ev.key==="Enter"){ev.preventDefault();apply();}ev.stopPropagation();});});
  upd();
  tm.appendChild(si);tm.appendChild(dash);tm.appendChild(ei);tm.appendChild(hrs);menuEl.appendChild(tm);
  var acts=document.createElement("div");acts.className="acts";
  function apply(){
    var a=parse(si.value),b=parse(ei.value);if(a===null||b===null||b<=a){hrs.textContent="finish must be after start";return;}
    closeMenu();
    DAYS.filter(function(d){return sel[d];}).forEach(function(d){setWin(d,run,a,b);});
  }
  var ok=document.createElement("button");ok.className="btn";ok.type="button";ok.textContent="Apply";ok.addEventListener("pointerdown",function(ev){ev.stopPropagation();});onTap(ok,function(ev){ev.stopPropagation();apply();});
  var off=document.createElement("button");off.className="btn";off.type="button";off.textContent="Doesn't run";off.addEventListener("pointerdown",function(ev){ev.stopPropagation();});onTap(off,function(ev){ev.stopPropagation();closeMenu();DAYS.filter(function(d){return sel[d];}).forEach(function(d){setOff(d,run,true);});});
  var rs=document.createElement("button");rs.className="btn";rs.type="button";rs.textContent="Reset";rs.title="Back to the standing time";rs.addEventListener("pointerdown",function(ev){ev.stopPropagation();});onTap(rs,function(ev){ev.stopPropagation();closeMenu();DAYS.filter(function(d){return sel[d];}).forEach(function(d){resetWin(d,run);});});
  var tb=document.createElement("button");tb.className="btn";tb.type="button";tb.textContent=isTrain(day,run)?"Not training":"Training";tb.title="Mark the ticked days as training runs";
  tb.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
  onTap(tb,function(ev){ev.stopPropagation();closeMenu();var on=!isTrain(day,run);DAYS.filter(function(d){return sel[d];}).forEach(function(d){setTrain(d,run,on);});});
  acts.appendChild(ok);acts.appendChild(off);acts.appendChild(tb);acts.appendChild(rs);menuEl.appendChild(acts);
  menuEl.hidden=false;
  var r=anchor.getBoundingClientRect(),mw=menuEl.offsetWidth,mh=menuEl.offsetHeight;
  var x=r.left,y=r.bottom+4;
  if(x+mw>window.innerWidth-8)x=window.innerWidth-mw-8;
  if(y+mh>window.innerHeight-8)y=r.top-mh-4;
  menuEl.style.left=Math.max(8,x)+"px";menuEl.style.top=Math.max(8,y)+"px";
  setTimeout(function(){si.focus();},0);
}
function closeMenu(){menuEl.hidden=true;menuReopen=null;}
document.addEventListener("pointerdown",function(ev){if(!menuEl.hidden&&!menuEl.contains(ev.target))closeMenu();},true);
document.addEventListener("keydown",function(ev){if(ev.key==="Escape"){closeMenu();state.pick=null;hint(null);render();}});
/* a drag that never got its pointerup (released outside the page) must not linger */
window.addEventListener("blur",function(){if(drag){ghost.hidden=true;drag.el.classList.remove("lifting","armed");drag=null;}});
window.addEventListener("error",function(ev){try{setStatus("error: "+(ev.message||"unknown"));}catch(e){}});
window.addEventListener("unhandledrejection",function(ev){try{var r=ev.reason;setStatus("error: "+(r&&(r.message||r.code)||r));}catch(e){}});
var armDel=null;
function rightClick(el,label,fn,twoStep){
  el.addEventListener("contextmenu",function(ev){
    ev.preventDefault();ev.stopPropagation();
    if(!twoStep){fn();return;}
    var k=label;
    if(armDel&&armDel.k===k&&Date.now()-armDel.t<4000){armDel=null;hint(null);fn();return;}
    armDel={k:k,t:Date.now()};
    hint("Right-click again to remove "+label+" from the board",4000);
  });
}
function dragSource(el,kind,id,from){
  el.addEventListener("pointerdown",function(ev){startDrag(kind,id,from,ev,el);});
  el.addEventListener("dragstart",function(ev){ev.preventDefault();});
}
function emptyTap(el,kind,day,run){
  el.addEventListener("pointerdown",function(ev){
    if(ev.button!==undefined&&ev.button>0)return;
    drag={kind:kind,id:null,from:null,x0:ev.clientX,y0:ev.clientY,moved:false,el:el,slot:{day:day,run:run}};
  });
}

/* ---------- render ---------- */
function render(){
  if(!(menuReopen&&!menuEl.hidden))closeMenu();
  var a=analyse();
  UNC=uncKeys();
  document.getElementById("wklab").textContent=short(state.mon)+" – "+short(addDays(state.mon,6))+" "+state.mon.getFullYear();
  document.getElementById("gridTitle").textContent="Week of "+short(state.mon);

  var dp=document.getElementById("drvPool");dp.innerHTML="";
  DRIVERS.forEach(function(d){
    var c=document.createElement("div");
    c.className="chip"+(state.pick&&state.pick.kind==="driver"&&state.pick.id===d[0]?" picked":"");
    var h=a.drvHrs[d[0]]||0;
    var nr=a.drvRuns[d[0]]||0,nt=a.drvTrain[d[0]]||0;
    c.innerHTML='<span>'+d[1]+'</span><span class="meta">'+(h?hh(h)+" h · "+(nr?nr+" run"+(nr===1?"":"s"):"")+(nr&&nt?" · ":"")+(nt?nt+" training":""):"—")+'</span>';
    dragSource(c,"driver",d[0],null);
    rightClick(c,d[1],function(){removeDriver(d[0]);},true);
    c.addEventListener("keydown",function(ev){if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();tap({kind:"driver",id:d[0],from:null});}});
    dp.appendChild(c);
  });

  var ap=document.getElementById("addPool");ap.innerHTML="";
  ADDONS.forEach(function(a){
    var c=document.createElement("div");
    c.className="chip addon"+(state.pick&&state.pick.kind==="addon"&&state.pick.id===a.id?" picked":"");
    c.innerHTML='<span>'+esc(a.name)+'</span><span class="meta">'+esc(a.task?a.when:(a.min>=60?(a.min/60)+"h":a.min+"m"))+'</span>';
    if(TWBY[a.id])c.title="Timing rule · "+twWhere(TWBY[a.id])+" · tick it on the run that does it each day";
    dragSource(c,"addon",a.id,null);
    ap.appendChild(c);
  });
  var vp=document.getElementById("vanPool");vp.innerHTML="";
  state.cfg.vans.forEach(function(v){
    var c=document.createElement("div");
    c.className="vcard"+(state.pick&&state.pick.kind==="van"&&state.pick.id===v.id?" picked":"");
    var days=Object.keys(a.vanDays[v.id]||{}).length;
    c.title=v.make||"";
    c.innerHTML=vanSVG(v,96,true)+'<span class="mk">'+(days?'<b>'+days+' d</b> · '+a.vanRuns[v.id]+' runs':'spare this week')+'</span>';
    dragSource(c,"van",v.id,null);
    rightClick(c,v.plate,function(){removeVan(v.id);},true);
    c.addEventListener("keydown",function(ev){if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();tap({kind:"van",id:v.id,from:null});}});
    vp.appendChild(c);
  });

  /* driver editor */
  var de=document.getElementById("drvEditor");de.hidden=!state.editDrivers;de.innerHTML="";
  document.getElementById("editDrivers").textContent=state.editDrivers?"Done":"Edit";
  if(state.editDrivers){
    state.cfg.drivers.forEach(function(d){
      var row=document.createElement("div");row.className="vanEdit";
      var nm=document.createElement("input");nm.className="make";nm.value=d.name;nm.id="drv-"+d.id;nm.setAttribute("aria-label","Driver name");nm.placeholder="name";
      nm.addEventListener("change",function(){d.name=nm.value.trim()||d.name;saveCfg();render();});
      var del=document.createElement("button");del.type="button";del.textContent="remove";
      onTap(del,function(){removeDriver(d.id);});
      row.appendChild(nm);row.appendChild(del);de.appendChild(row);
    });
  }
  var ve=document.getElementById("vanEditor");ve.hidden=!state.editFleet;ve.innerHTML="";
  document.getElementById("editFleet").textContent=state.editFleet?"Done":"Edit";
  if(state.editFleet){
    state.cfg.vans.forEach(function(v){
      var row=document.createElement("div");row.className="vanEdit";
      var pl=document.createElement("input");pl.value=v.plate;pl.setAttribute("aria-label","Plate");pl.id="plate-"+v.id;
      pl.addEventListener("change",function(){v.plate=(pl.value||v.plate).toUpperCase();saveCfg();render();});
      var mk=document.createElement("input");mk.className="make";mk.value=v.make||"";mk.placeholder="make / model";mk.id="make-"+v.id;mk.setAttribute("aria-label","Make");
      mk.addEventListener("change",function(){v.make=mk.value;saveCfg();render();});
      var col=document.createElement("select");col.id="col-"+v.id;col.setAttribute("aria-label","Colour");
      Object.keys(COLOURS).forEach(function(k){var o=document.createElement("option");o.value=k;o.textContent=k;if(k===v.col)o.selected=true;col.appendChild(o);});
      col.addEventListener("change",function(){v.col=col.value;saveCfg();render();});
      var del=document.createElement("button");del.type="button";del.textContent="remove";
      onTap(del,function(){removeVan(v.id);});
      [pl,mk,col,del].forEach(function(n){row.appendChild(n);});
      ve.appendChild(row);
    });
  }

  var errKeys={};a.issues.forEach(function(i){if(i.lv==="crit")errKeys[i.k]=1;});
  var dayDone={};
  DAYS.forEach(function(day){
    var rs=slots(day);if(!rs.length){dayDone[day]=false;return;}
    var ok=true;
    rs.forEach(function(run){if(run==="BU")return;   /* an empty Back up row doesn't stop a day being complete */
      if(W[run].novan&&!anyDrv(get(day,run)))return;   /* nor does an empty sort row */
      var x=get(day,run);if(!x.drv||(!x.van&&!W[run].novan)||errKeys[day+"|"+run])ok=false;});
    dayDone[day]=ok;
  });
  var t=document.getElementById("grid");t.innerHTML="";
  var thead=document.createElement("thead"),tr=document.createElement("tr");
  var th0=document.createElement("th");th0.className="runcol";th0.textContent="Run";tr.appendChild(th0);
  DAYS.forEach(function(d,i){var th=document.createElement("th");th.innerHTML=d+'<span class="dt">'+short(addDays(state.mon,i))+'</span>'+(dayDone[d]?' <span class="dt">✓ complete</span>':'');if(dayDone[d])th.classList.add("done");tr.appendChild(th);});
  thead.appendChild(tr);t.appendChild(thead);

  var tb=document.createElement("tbody");
  ORDER.forEach(function(run){
    var row=document.createElement("tr");
    row.className=(W[run].net==="tge"?"tge":(W[run].net==="sun"?"sunr":""))+(W[run].slim?" slim":"");
    var rc=document.createElement("td");rc.className="runcol";
    rc.innerHTML='<span class="code">'+(W[run].label||run)+'</span>'+(W[run].hard?'<span class="tag hard">hard</span>':'')+(W[run].rest?'<span class="tag rest">restr</span>':'')+
      '<span class="nm">'+W[run].name+'</span>';
    row.appendChild(rc);
    DAYS.forEach(function(day){
      if(day===COMBINED.day&&run===COMBINED.under)return;          /* drawn as part of the row above */
      var td=document.createElement("td");td.className="cell"+(dayDone[day]?" dayok":"")+(isTrain(day,run)?" train":"");td.dataset.day=day;td.dataset.run=run;
      if(day===COMBINED.day&&run===COMBINED.top){td.rowSpan=2;td.classList.add("combined");}
      if(!win(run,day)){
        td.classList.add("off");
        if(W[run].fixed){td.classList.add("fixed");row.appendChild(td);return;}   /* this run only ever goes on its own days: no add option */
        var addB=document.createElement("span");addB.className="rt";addB.textContent="+";addB.title="Add "+RL(run)+" on "+day;
        addB.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
        onTap(addB,function(ev){ev.stopPropagation();if(defWin(run,day))resetWin(day,run);else setWin(day,run,6*60,10*60);});
        td.appendChild(addB);row.appendChild(td);return;
      }
      var asg=get(day,run),bad=errKeys[day+"|"+run];
      var unc=UNC[day+"|"+run];
      if(unc){td.classList.add("unconf");td.title="Change not confirmed yet by "+unc.join(", ");}
      var w=document.createElement("div");w.className="win";
      w.innerHTML='<span class="wt" title="Click to change the run time">'+((day===COMBINED.day&&run===COMBINED.top)?'<b>'+COMBINED.label+'</b> · ':'')+winShort(run,day)+esc(extraText(day,run))+'</span>';
      var wt=w.querySelector(".wt");wt.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
      onTap(wt,function(ev){ev.stopPropagation();openTimeMenu(wt,day,run);});
      if(asg.tr){
        var tt=document.createElement("span");tt.className="tag-t";tt.textContent="T · "+(DNAME[asg.tr]||asg.tr);tt.title="Trainee — click to remove";
        tt.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
        tt.addEventListener("click",function(ev){ev.stopPropagation();setA(day,run,"tr",null);});
        w.appendChild(tt);
      }
      if(isTrain(day,run)){
        var trg=document.createElement("span");trg.className="tag-tr";trg.textContent="TRAINING";trg.title="Training day \u2014 click to make it a normal run";
        trg.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
        onTap(trg,function(ev){ev.stopPropagation();setTrain(day,run,false);});
        w.appendChild(trg);
      }
      if(unc){var ut=document.createElement("span");ut.className="tag-u";ut.textContent="? "+unc.map(function(n){return String(n).split(" ")[0];}).join(", ");ut.title="Not confirmed yet: "+unc.join(", ")+" — click to confirm or dismiss";
        ut.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
        (function(ut,day,run,unc){onTap(ut,function(ev){ev.stopPropagation();openUncMenu(ut,day,run,unc);});})(ut,day,run,unc);
        w.appendChild(ut);}
      var offB=document.createElement("span");offB.className="rt";offB.textContent="×";offB.title="Take "+RL(run)+" off "+day;
      offB.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
      onTap(offB,function(ev){ev.stopPropagation();setOff(day,run,true);});
      w.appendChild(offB);
      (asg.add||[]).forEach(function(id){
        if(!ADDON[id])return;
        var t=document.createElement("span");t.className="tag-a";t.textContent=ADDON[id].short;t.title=ADDON[id].name+" "+addMeta(ADDON[id])+" — click to remove";
        t.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
        t.addEventListener("click",function(ev){ev.stopPropagation();toggleAdd(day,run,id,false);});
        rightClick(t,"",function(){toggleAdd(day,run,id,false);},false);
        w.appendChild(t);
      });
      td.appendChild(w);
      td.addEventListener("pointerdown",function(ev){
        if(ev.button!==undefined&&ev.button>0)return;
        if(state.pick&&state.pick.kind==="addon")place("addon",state.pick.id,day,run,null);
      });
      var pair=document.createElement("div");pair.className="pair";
      pair.appendChild(slotEl("d","driver",day,run,asg.drv,bad));
      if(W[run].novan){var n=W[run].slots||2;pair.classList.add("multi");for(var si=2;si<=n;si++)pair.appendChild(slotEl("d","driver",day,run,asg["drv"+si],bad,"d"+si));td.appendChild(pair);row.appendChild(td);return;}
      var row2=document.createElement("div");row2.className="row2";
      row2.appendChild(slotEl("v","van",day,run,asg.van,bad));
      var as=document.createElement("div");as.className="slot a"+((asg.add&&asg.add.length)?" filled":"");as.dataset.kind="addon";as.dataset.day=day;as.dataset.run=run;
      as.textContent="+";as.title="Drop an add-on here · right-click clears them";
      rightClick(as,"",function(){setA(day,run,"add",null);},false);
      as.addEventListener("pointerdown",function(ev){
        if(ev.button!==undefined&&ev.button>0)return;
        ev.stopPropagation();
        if(state.pick&&state.pick.kind==="addon")place("addon",state.pick.id,day,run,null);
        else openMenu(as,day,run);
      });
      row2.appendChild(as);
      row2.appendChild(slotEl("t","driver",day,run,asg.tr,bad,"tr"));
      pair.appendChild(row2);
      td.appendChild(pair);
      row.appendChild(td);
    });
    tb.appendChild(row);
  });
  t.appendChild(tb);

  var tf=document.createElement("tfoot"),ftr=document.createElement("tr");
  var f0=document.createElement("td");f0.className="runcol";f0.textContent="Vans at peak";ftr.appendChild(f0);
  DAYS.forEach(function(day){
    var td=document.createElement("td"),p=peakVehicles(day);
    var filled=slots(day).filter(function(r){var x=get(day,r);return x.drv||x.van;}).length;
    td.innerHTML="<b>"+p+"</b> · "+filled+" runs"+(dayDone[day]?" · ✓ complete":"");
    if(dayDone[day])td.classList.add("done");
    ftr.appendChild(td);
  });
  tf.appendChild(ftr);t.appendChild(tf);
  sizeTopScroll();

  renderRoutes();
  renderDriverSet();
  renderNotes();
  renderDriverView();
  renderSkills();
  renderLeaveAll();
  renderCover();
  renderAvail();
  renderComm();
  renderNotices();
  var box=document.getElementById("issues");box.innerHTML="";
  var crit=a.issues.filter(function(i){return i.lv==="crit";}).length;
  document.getElementById("issueCount").textContent=a.issues.length?(crit+" to fix · "+(a.issues.length-crit)+" to watch"):"nothing to fix";
  if(!a.issues.length){box.innerHTML='<p class="clean"><b>Clean week.</b> Nobody is on two runs at once, no vehicle is in two places at once, every rostered run has a driver and a van, and the restricted routes are covered by cleared drivers.</p>';}
  else{
    var list=document.createElement("div");list.className="ilist";
    a.issues.forEach(function(i){
      var el=document.createElement("div");el.className="issue "+i.lv;
      el.innerHTML='<span class="dot"></span><span class="txt"><b>'+i.t+'</b>'+i.d+'</span>';
      list.appendChild(el);
    });
    box.appendChild(list);
  }
}

function timeSelect(val,id,onchange){
  var sel=document.createElement("select");sel.id=id;
  for(var t=4*60;t<=20*60;t+=15){var o=document.createElement("option");o.value=t;o.textContent=fmt(t);if(t===val)o.selected=true;sel.appendChild(o);}
  sel.addEventListener("change",function(){onchange(parseInt(sel.value,10));});
  sel.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
  return sel;
}
var A0=5*60,A1=18*60,R0=A0,R1=A1;
function rangeBar(s0,e0,commit,meta){
  var rb=document.createElement("div");rb.className="rb";
  for(var t=R0+60;t<R1;t+=60){var tk=document.createElement("i");tk.className="tick";tk.style.left=((t-R0)/(R1-R0)*100)+"%";rb.appendChild(tk);}
  var seg=document.createElement("div");seg.className="seg";
  var ls=document.createElement("span"),le=document.createElement("span");seg.appendChild(ls);seg.appendChild(le);
  var hl=document.createElement("div");hl.className="h l";var hr=document.createElement("div");hr.className="h r";
  seg.appendChild(hl);seg.appendChild(hr);rb.appendChild(seg);
  var cs=s0,ce=e0;
  function paint(){
    seg.style.left=((cs-R0)/(R1-R0)*100)+"%";seg.style.width=((ce-cs)/(R1-R0)*100)+"%";
    ls.textContent=fmt(cs);le.textContent=fmt(ce);
    if(meta){var b=meta.querySelector("b");if(b)b.textContent=fmt(cs)+"–"+fmt(ce);}
  }
  paint();
  function tAt(x){var r=rb.getBoundingClientRect();var t=R0+(x-r.left)/r.width*(R1-R0);return Math.max(R0,Math.min(R1,Math.round(t/15)*15));}
  function grab(el,mode){
    el.addEventListener("pointerdown",function(ev){
      if(ev.button!==undefined&&ev.button>0)return;
      ev.stopPropagation();ev.preventDefault();
      var x0=ev.clientX,s1=cs,e1=ce,len=ce-cs;
      try{el.setPointerCapture(ev.pointerId);}catch(e){}
      seg.classList.add("dragging");
      function mv(e2){
        var t=tAt(e2.clientX);
        if(mode==="l"){cs=Math.min(t,ce-15);}
        else if(mode==="r"){ce=Math.max(t,cs+15);}
        else{var r=rb.getBoundingClientRect();var dt=Math.round(((e2.clientX-x0)/r.width*(R1-R0))/15)*15;cs=Math.max(R0,Math.min(R1-len,s1+dt));ce=cs+len;}
        paint();
      }
      function up(){el.removeEventListener("pointermove",mv);el.removeEventListener("pointerup",up);el.removeEventListener("pointercancel",up);seg.classList.remove("dragging");
        if(cs!==s0||ce!==e0)commit(cs,ce);}
      el.addEventListener("pointermove",mv);el.addEventListener("pointerup",up);el.addEventListener("pointercancel",up);
    });
    el.addEventListener("contextmenu",function(ev){ev.preventDefault();ev.stopPropagation();});
  }
  grab(hl,"l");grab(hr,"r");grab(seg,"m");
  return rb;
}
function renderRoutes(){
  var t=document.getElementById("routesGrid");t.innerHTML="";
  var thead=document.createElement("thead"),tr=document.createElement("tr");
  var th0=document.createElement("th");th0.textContent="Run";tr.appendChild(th0);
  DAYS.forEach(function(d){var th=document.createElement("th");th.textContent=d;tr.appendChild(th);});
  thead.appendChild(tr);t.appendChild(thead);
  var tb=document.createElement("tbody");
  ORDER.forEach(function(run){
    var row=document.createElement("tr");
    var rc=document.createElement("td");rc.className="rc";rc.innerHTML=esc(RL(run))+'<span>'+esc(W[run].name)+'</span>';row.appendChild(rc);
    DAYS.forEach(function(day){
      var td=document.createElement("td");
      var w=win(run,day),d=defWin(run,day),k=day+"|"+run;
      if(W[run].fixed&&!d){row.appendChild(td);return;}
      var custom=!!(state.cfg.win&&state.cfg.win[k]!==undefined);
      var box=document.createElement("div");box.className="tw"+(w?"":" off")+(custom?" custom":"");
      var meta=document.createElement("div");meta.className="meta2";
      if(day===COMBINED.day&&run===COMBINED.under){var cm=document.createElement("span");cm.textContent="with "+RL(COMBINED.top)+" (combined)";meta.appendChild(cm);box.appendChild(meta);td.appendChild(box);row.appendChild(td);return;}
      if(w){
        box.appendChild(rangeBar(w[0][0],w[w.length-1][1],function(a,b){setWin(day,run,a,b);},meta));
        var h=document.createElement("span");h.innerHTML="<b>"+fmt(w[0][0])+"–"+fmt(w[w.length-1][1])+"</b> · "+hh(dur(run,day))+"h";meta.appendChild(h);
      }else{
        var no=document.createElement("span");no.textContent="doesn't run";meta.appendChild(no);
      }
      box.appendChild(meta);
      var on=document.createElement("label");on.className="on";
      var cb=document.createElement("input");cb.type="checkbox";cb.checked=!!w;cb.id="on-"+k;
      cb.addEventListener("change",function(){
        if(cb.checked){ if(d)resetWin(day,run); else setWin(day,run,6*60,10*60); }
        else setOff(day,run,true);
      });
      on.appendChild(cb);on.appendChild(document.createTextNode("runs"));meta.appendChild(on);
      if(custom){var rs=document.createElement("span");rs.className="rs";rs.textContent="reset";rs.title="Back to the operations-document timing";rs.addEventListener("click",function(){resetWin(day,run);});meta.appendChild(rs);}
      td.appendChild(box);row.appendChild(td);
    });
    tb.appendChild(row);
  });
  t.appendChild(tb);
}
function renderDriverSet(){
  var t=document.getElementById("dsetGrid");t.innerHTML="";
  var thead=document.createElement("thead"),tr=document.createElement("tr");
  var th0=document.createElement("th");th0.textContent="Driver";tr.appendChild(th0);
  DAYS.forEach(function(d){var th=document.createElement("th");th.textContent=d;tr.appendChild(th);});
  thead.appendChild(tr);t.appendChild(thead);
  var tb=document.createElement("tbody");
  state.cfg.drivers.forEach(function(d){
    var row=document.createElement("tr");
    var dc=document.createElement("td");dc.className="dc";dc.textContent=d.name;row.appendChild(dc);
    DAYS.forEach(function(day){
      var td=document.createElement("td"),k=day+"|"+d.id;
      var av=availOf(d.id,day),custom=!!(state.cfg.avail&&state.cfg.avail[k]!==undefined);
      var box=document.createElement("div");box.className="tw"+(av?"":" off")+(custom?" custom":"");
      var meta=document.createElement("div");meta.className="meta2";
      if(av){
        box.appendChild(rangeBar(av[0],av[1],function(a,b){setAvail(day,d.id,a,b);},meta));
        var h=document.createElement("span");h.innerHTML="<b>"+fmt(av[0])+"–"+fmt(av[1])+"</b> · "+hh(av[1]-av[0])+"h";meta.appendChild(h);
      }else{var no=document.createElement("span");no.textContent="not available";meta.appendChild(no);}
      box.appendChild(meta);
      var on=document.createElement("label");on.className="on";
      var cb=document.createElement("input");cb.type="checkbox";cb.checked=!!av;cb.id="av-"+k;
      cb.addEventListener("change",function(){if(cb.checked)resetAvail(day,d.id);else setAvail(day,d.id,null);});
      on.appendChild(cb);on.appendChild(document.createTextNode("available"));meta.appendChild(on);
      if(custom&&av){var rs=document.createElement("span");rs.className="rs";rs.textContent="reset";rs.addEventListener("click",function(){resetAvail(day,d.id);});meta.appendChild(rs);}
      td.appendChild(box);row.appendChild(td);
    });
    tb.appendChild(row);
  });
  t.appendChild(tb);
}
function renderDriverView(){
  var t=document.getElementById("dviewGrid");t.innerHTML="";
  var thead=document.createElement("thead"),tr=document.createElement("tr");
  var th0=document.createElement("th");th0.textContent="Driver";tr.appendChild(th0);
  DAYS.forEach(function(d,i){var th=document.createElement("th");th.innerHTML=d+'<span class="dt">'+short(addDays(state.mon,i))+'</span>';tr.appendChild(th);});
  thead.appendChild(tr);t.appendChild(thead);
  var tb=document.createElement("tbody");
  state.cfg.drivers.forEach(function(d){
    var row=document.createElement("tr");
    var dc=document.createElement("td");dc.className="dc";dc.textContent=d.name;dc.title="drag onto a run";
    dragSource(dc,"driver",d.id,null);
    row.appendChild(dc);
    DAYS.forEach(function(day){
      var td=document.createElement("td");
      var av=availOf(d.id,day);
      var busy=[];
      slots(day).forEach(function(run){var a=get(day,run);if(a.drv===d.id||a.drv2===d.id||a.drv3===d.id||a.drv4===d.id||a.tr===d.id){var sp=espan(run,day);busy.push({s:sp[0],e:sp[1],run:run,tr:(a.tr===d.id&&a.drv!==d.id)||isTrain(day,run)});}});
      busy.sort(function(a,b){return a.s-b.s;});
      var bar=document.createElement("div");bar.className="abar";
      function pct(t){return (Math.max(A0,Math.min(A1,t))-A0)/(A1-A0)*100;}
      if(!av){var na=document.createElement("span");na.className="na";na.style.left="0";na.style.width="100%";bar.appendChild(na);}
      else{
        if(av[0]>A0){var n1=document.createElement("span");n1.className="na";n1.style.left="0";n1.style.width=pct(av[0])+"%";bar.appendChild(n1);}
        if(av[1]<A1){var n2=document.createElement("span");n2.className="na";n2.style.left=pct(av[1])+"%";n2.style.width=(100-pct(av[1]))+"%";bar.appendChild(n2);}
      }
      busy.forEach(function(b){var i=document.createElement("i");i.style.left=pct(b.s)+"%";i.style.width=(pct(b.e)-pct(b.s))+"%";i.title=RL(b.run)+(b.tr?" (trainee) ":" ")+fmt(b.s)+"–"+fmt(b.e);if(b.tr)i.style.background="var(--warn)";bar.appendChild(i);});
      td.appendChild(bar);
      var txt=document.createElement("div");txt.className="afree";
      if(!av){txt.innerHTML='<span class="busy">'+(leaveOn(d.id,day)?'on leave':'not available')+'</span>'+(busy.length?' — <b style="color:var(--crit)">but rostered: '+busy.map(function(b){return RL(b.run)+(b.tr?" (training)":"");}).join(", ")+'</b>':'');}
      else{
        var free=[],cur=av[0];
        busy.forEach(function(b){if(b.s>cur+14)free.push([cur,Math.min(b.s,av[1])]);cur=Math.max(cur,b.e);});
        if(av[1]>cur+14)free.push([cur,av[1]]);
        function lab(b){return RL(b.run)+(b.tr?" (training)":"");}
        if(!busy.length)txt.innerHTML="<b>free</b> "+fmt(av[0])+"–"+fmt(av[1]);
        else if(!free.length)txt.innerHTML='<span class="busy">'+busy.map(lab).join(" · ")+'</span> — no gap';
        else txt.innerHTML='<b>free</b> '+free.map(function(f){return fmt(f[0])+"–"+fmt(f[1]);}).join(" · ")+' <span class="busy">· '+busy.map(lab).join(", ")+'</span>';
      }
      td.appendChild(txt);row.appendChild(td);
    });
    tb.appendChild(row);
  });
  t.appendChild(tb);
}
/* handovers: whenever someone moves between two runs in a day as a trainee (or from riding along to their own run),
   the two drivers involved have to organise where and when the swap happens */
var DEPOT_BREAK=["FB","FBP","FB2","FB2P"];   /* Sunday food bag: back at the depot between AM and PM, so swaps happen there */
function swapNotes(){
  var out=[];
  DAYS.forEach(function(day){
    var per={};
    slots(day).forEach(function(run){
      if(W[run].novan)return;
      var a=get(day,run);
      if(a.drv)(per[a.drv]=per[a.drv]||[]).push({run:run,role:"drv",a:a});
      if(a.tr&&a.tr!==a.drv)(per[a.tr]=per[a.tr]||[]).push({run:run,role:"tr",a:a});
    });
    Object.keys(per).forEach(function(p){
      var L=per[p].slice().sort(function(x,y){return espan(x.run,day)[0]-espan(y.run,day)[0];});
      for(var i=1;i<L.length;i++){
        var x=L[i-1],y=L[i];
        if(isPair(x.run,y.run))continue;
        if(x.role==="drv"&&y.role==="drv")continue;          /* their own runs back to back — nothing to hand over */
        if(x.role==="tr"&&y.role==="tr"&&x.a.drv&&x.a.drv===y.a.drv)continue;   /* staying with the same driver all day */
        var e=espan(x.run,day)[1],s=espan(y.run,day)[0];
        var who={};if(x.role==="tr"&&x.a.drv)who[x.a.drv]=1;if(y.role==="tr"&&y.a.drv)who[y.a.drv]=1;who[p]=1;
        var names=Object.keys(who).map(function(k){return DNAME[k]||k;});
        var fromT=RL(x.run)+(x.role==="tr"?" with "+(DNAME[x.a.drv]||"—"):" (driving)");
        var toT=RL(y.run)+(y.role==="tr"?" with "+(DNAME[y.a.drv]||"—"):" (driving"+(y.a.van?" "+plateOf(y.a.van):"")+")");
        var atDepot=DEPOT_BREAK.indexOf(x.run)>=0&&DEPOT_BREAK.indexOf(y.run)>=0;   /* the round comes back to the depot between shifts */
        out.push({day:day,html:'<b>'+day+' — '+esc(DNAME[p]||p)+'</b> moves from '+esc(fromT)+' to '+esc(toT)+' (starts '+fmt(s)+'). '+
          (atDepot?'Changeover at the depot at '+fmt(s)+' — the round comes back between the morning and afternoon shifts.':
          esc(names.slice(0,-1).join(", ")+(names.length>1?" and ":"")+names[names.length-1])+' to organise where and when the swap happens.')+
          (s<e?' <span class="ov">· board times overlap ('+RL(x.run)+' ends '+fmt(e)+') — set the training finish time</span>':''),
          text:day+" — "+(DNAME[p]||p)+" moves from "+fromT+" to "+toT+" (starts "+fmt(s)+"). "+names.join(" and ")+" to organise the swap."});
      }
    });
  });
  return out;
}
/* split shifts: a gap of an hour or more between one person's work in a day (Back up is on-call so it doesn't count;
   an all-day Support row would hide every gap, so Support only counts when it's set to under 8 hours) */
var SPLIT_MIN=60;
function splitNotes(){
  var out=[];
  DAYS.forEach(function(day){
    var per={};
    slots(day).forEach(function(run){
      if(run==="BU")return;
      var w=win(run,day);if(!w)return;
      if(W[run].novan&&dur(run,day)>=8*60)return;
      var a=get(day,run),x=extraMin(day,run);
      ["drv","drv2","drv3","drv4","tr"].forEach(function(f){
        var p=a[f];if(!p)return;
        var st0=(W[run].novan&&f!=="tr"&&a[stKey(f)])?Math.round(a[stKey(f)]*60):null;   /* support: from that person's own start time */
        w.forEach(function(sg,i){var s=st0!==null?Math.max(sg[0],st0):sg[0],e=sg[1]+(i===w.length-1?x:0);if(e>s)(per[p]=per[p]||[]).push({s:s,e:e,run:run});});
      });
    });
    Object.keys(per).forEach(function(p){
      var L=per[p].sort(function(a,b){return a.s-b.s;}),cur=null,gaps=[];
      L.forEach(function(sg){
        if(!cur){cur={s:sg.s,e:sg.e,run:sg.run};return;}
        if(sg.s-cur.e>=SPLIT_MIN)gaps.push({from:cur.run,e:cur.e,to:sg.run,s:sg.s});
        if(sg.s>cur.e)cur={s:sg.s,e:sg.e,run:sg.run};else if(sg.e>cur.e){cur.e=sg.e;cur.run=sg.run;}
      });
      gaps.forEach(function(g){
        var mins=g.s-g.e,h=Math.floor(mins/60),mm=mins%60;
        out.push({html:'<b>'+day+' — '+esc(DNAME[p]||p)+'</b>: '+esc(RL(g.from))+' finishes '+fmt(g.e)+', '+(g.from===g.to?'back on ':'')+esc(RL(g.to))+' starts '+fmt(g.s)+' — '+(h?h+'h':'')+(mm?(h?' ':'')+mm+'m':'')+' gap (split shift).'});
      });
    });
  });
  return out;
}
function renderNotes(){
  var box=document.getElementById("swapList"),n=swapNotes(),sp=splitNotes();
  box.innerHTML=(n.length?'<h3>Swaps to organise</h3><ul>'+n.map(function(x){return '<li>'+x.html+'</li>';}).join("")+'</ul>':'<p>No handovers between drivers this week.</p>')+
    (sp.length?'<h3>Split shifts</h3><ul>'+sp.map(function(x){return '<li>'+x.html+'</li>';}).join("")+'</ul>':'<p>No split shifts this week.</p>');
  var ta=document.getElementById("weekNotes");
  if(document.activeElement!==ta)ta.value=state.data.notes||"";
}
(function(){
  var ta=document.getElementById("weekNotes"),t=null;
  ta.addEventListener("input",function(){state.data.notes=ta.value;clearTimeout(t);t=setTimeout(save,500);});
  ta.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
  ta.addEventListener("keydown",function(ev){ev.stopPropagation();});
})();
function renderSkills(){
  var t=document.getElementById("skillGrid");t.innerHTML="";
  var thead=document.createElement("thead"),tr=document.createElement("tr");
  var th0=document.createElement("th");th0.className="dc";th0.textContent="Driver";tr.appendChild(th0);
  SKILL_RUNS.forEach(function(s){var th=document.createElement("th");th.innerHTML=esc(s==="FB"?"Food bag":RL(s))+'<span>'+esc(s==="FB"?"Sunday":W[s].name)+'</span>';tr.appendChild(th);});
  thead.appendChild(tr);
  /* depth: how many people (not counting Jeremy) are signed off on each run */
  var dr=document.createElement("tr");dr.className="depth";
  var dh=document.createElement("th");dh.className="dc";dh.innerHTML='Depth<span>signed off, not counting Jeremy</span>';dr.appendChild(dh);
  SKILL_RUNS.forEach(function(s){
    var n=state.cfg.drivers.filter(function(d){return d.id!=="J"&&(state.cfg.skills||{})[d.id+"|"+s]==="yes";}).length;
    var tn=state.cfg.drivers.filter(function(d){return d.id!=="J"&&(state.cfg.skills||{})[d.id+"|"+s]==="tr";}).length;
    var c=document.createElement("th"),lv=n<=1?"d1":(n===2?"d2":(n===3?"d3":"d4"));
    c.innerHTML='<b class="dp '+lv+'">'+n+'</b><span>'+(n<=1?"thin":(n===2?"low":(n===3?"ok":"good")))+(tn?" · +"+tn+" training":"")+'</span>';
    c.title=n+" signed off"+(tn?", "+tn+" in training":"");dr.appendChild(c);
  });
  thead.appendChild(dr);t.appendChild(thead);
  var tb=document.createElement("tbody");
  state.cfg.drivers.forEach(function(d){
    var row=document.createElement("tr");
    var dc=document.createElement("td");dc.className="dc";dc.textContent=d.name;row.appendChild(dc);
    SKILL_RUNS.forEach(function(s){
      var td=document.createElement("td"),v=(state.cfg.skills||{})[d.id+"|"+s]||"";
      var b=document.createElement("span");b.className="sk"+(v?" "+v:"");b.textContent=v==="yes"?"✓":(v==="tr"?"training":"—");
      b.title=d.name+" on "+s+" — click to change";
      b.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
      onTap(b,function(ev){ev.stopPropagation();cycleSkill(d.id,s);});
      td.appendChild(b);row.appendChild(td);
    });
    tb.appendChild(row);
  });
  t.appendChild(tb);
}
function renderAvail(){
  var t=document.getElementById("availGrid");t.innerHTML="";
  var thead=document.createElement("thead"),tr=document.createElement("tr");
  var th0=document.createElement("th");th0.textContent="Vehicle";tr.appendChild(th0);
  DAYS.forEach(function(d,i){var th=document.createElement("th");th.innerHTML=d+'<span class="dt">'+short(addDays(state.mon,i))+'</span>';tr.appendChild(th);});
  thead.appendChild(tr);t.appendChild(thead);
  var tb=document.createElement("tbody");
  state.cfg.vans.forEach(function(v){
    var row=document.createElement("tr");
    var vc=document.createElement("td");vc.className="vc";vc.innerHTML=vanSVG(v,44,false)+'<span>'+esc(v.plate)+'</span>';vc.title=(v.make||"")+" — drag onto a run";
    dragSource(vc,"van",v.id,null);
    row.appendChild(vc);
    DAYS.forEach(function(day){
      var td=document.createElement("td");
      var busy=[];
      slots(day).forEach(function(run){var a=get(day,run);if(a.van===v.id){var sp=espan(run,day);busy.push({s:sp[0],e:sp[1],run:run});}});
      busy.sort(function(a,b){return a.s-b.s;});
      var bar=document.createElement("div");bar.className="abar";
      busy.forEach(function(b){var i=document.createElement("i");i.style.left=((Math.max(b.s,A0)-A0)/(A1-A0)*100)+"%";i.style.width=((Math.min(b.e,A1)-Math.max(b.s,A0))/(A1-A0)*100)+"%";i.title=RL(b.run)+" "+fmt(b.s)+"–"+fmt(b.e);bar.appendChild(i);});
      td.appendChild(bar);
      var free=[],cur=A0;
      busy.forEach(function(b){if(b.s>cur+14)free.push([cur,b.s]);cur=Math.max(cur,b.e);});
      if(A1>cur+14)free.push([cur,A1]);
      var txt=document.createElement("div");txt.className="afree";
      if(!busy.length)txt.innerHTML="<b>free all day</b>";
      else if(!free.length)txt.innerHTML='<span class="busy">'+busy.map(function(b){return RL(b.run);}).join(" · ")+'</span> — no gap';
      else txt.innerHTML='<b>free</b> '+free.map(function(f){return fmt(f[0])+"–"+fmt(f[1]);}).join(" · ")+' <span class="busy">· '+busy.map(function(b){return RL(b.run);}).join(", ")+'</span>';
      td.appendChild(txt);
      row.appendChild(td);
    });
    tb.appendChild(row);
  });
  t.appendChild(tb);
}
function slotEl(cls,kind,day,run,val,bad,role){
  var el=document.createElement("div"),f=fieldOf(kind,role),from=day+"|"+run+"|"+f;
  el.className="slot "+cls+(val?" filled":"")+(bad&&val?" err":"");
  el.dataset.kind=kind;el.dataset.day=day;el.dataset.run=run;if(role)el.dataset.role=role;
  if(val){
    if(kind==="van"){var v=vanOf(val);el.innerHTML='<span>'+esc(plateOf(val).replace(/[0-9]/g,""))+'</span>';el.title=plateOf(val);}
    else if(role==="tr"){el.innerHTML='<span>T</span>';el.title="Trainee: "+(DNAME[val]||val)+" — right-click to clear";}
    else el.innerHTML='<span>'+esc(DNAME[val]||val)+'</span>';
    if(kind==="driver"&&role!=="tr"&&W[run].novan){
      var sk=stKey(f),sv=get(day,run)[sk];
      var st=document.createElement("span");st.className="st";st.title="Start hour (am) — click the arrows";
      st.innerHTML='<b>'+(sv?fmtSt(sv):"–")+'</b><span class="ar"><i class="up">▲</i><i class="dn">▼</i></span>';
      st.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
      st.querySelector(".up").addEventListener("click",function(ev){ev.stopPropagation();var v=sv?Math.min(ST_MAX,sv+0.5):ST_MIN;setA(day,run,sk,v);});
      st.querySelector(".dn").addEventListener("click",function(ev){ev.stopPropagation();var v=sv?Math.max(ST_MIN,sv-0.5):ST_MAX;setA(day,run,sk,v);});
      el.appendChild(st);
    }
    var x=document.createElement("span");x.className="x";x.textContent="×";x.title="Clear";
    x.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
    x.addEventListener("click",function(ev){ev.stopPropagation();setA(day,run,f,null);});
    el.appendChild(x);
    dragSource(el,kind,val,from);
    rightClick(el,"",function(){setA(day,run,f,null);},false);
    /* a filled slot: a plain click (no drag) opens the picker to swap or fill more days */
    el.addEventListener("pointerdown",function(ev){if(!(ev.button>0)&&!state.pick){el._tapMenu=true;}});
    el.addEventListener("pointerup",function(ev){if(el._tapMenu){el._tapMenu=false;var wasDrag=drag&&drag.moved;setTimeout(function(){if(!wasDrag&&!drag)openPickMenu(el,kind,day,run,role);},0);}});
  }else{
    el.innerHTML='<span>'+(kind==="driver"?(role==="tr"?"T":"driver"):"van")+'</span>';
    if(role==="tr")el.title="Trainee — drop a driver here, or click to pick one";
    el.addEventListener("pointerdown",function(ev){
      if(ev.button!==undefined&&ev.button>0)return;
      /* an empty box always opens the list — a leftover tap-pick must not fill it on its own */
      if(state.pick){state.pick=null;hint(null);}
      ev.stopPropagation();openPickMenu(el,kind,day,run,role);
    });
  }
  el.addEventListener("keydown",function(ev){
    if(ev.key==="Enter"||ev.key===" "){
      ev.preventDefault();
      if(val)tap({kind:kind,id:val,from:from});
      else openPickMenu(el,kind,day,run,role);
    }
  });
  return el;
}

/* ---------- controls ---------- */
onTap(document.getElementById("routesHead"),function(){
  var box=document.getElementById("routesBox");box.classList.toggle("closed");
  try{localStorage.setItem("taieri-routes-open",box.classList.contains("closed")?"0":"1");}catch(e){}
  fit();
});
try{if(localStorage.getItem("taieri-routes-open")==="0")document.getElementById("routesBox").classList.add("closed");}catch(e){}
[["dsetHead","dsetBox","taieri-dset-open","0"],["dviewHead","dviewBox","taieri-dview-open","1"]].forEach(function(c){
  onTap(document.getElementById(c[0]),function(){
    var box=document.getElementById(c[1]);box.classList.toggle("closed");
    try{localStorage.setItem(c[2],box.classList.contains("closed")?"0":"1");}catch(e){}
    fit();
  });
  try{var v=localStorage.getItem(c[2]);if(v==="0")document.getElementById(c[1]).classList.add("closed");else if(v==="1")document.getElementById(c[1]).classList.remove("closed");}catch(e){}
});
onTap(document.getElementById("notesHead"),function(){
  var box=document.getElementById("notesBox");box.classList.toggle("closed");
  try{localStorage.setItem("taieri-notes-open",box.classList.contains("closed")?"0":"1");}catch(e){}
  fit();
});
try{if(localStorage.getItem("taieri-notes-open")==="0")document.getElementById("notesBox").classList.add("closed");}catch(e){}
onTap(document.getElementById("skillHead"),function(){
  var box=document.getElementById("skillBox");box.classList.toggle("closed");
  try{localStorage.setItem("taieri-skill-open",box.classList.contains("closed")?"0":"1");}catch(e){}
  fit();
});
try{if(localStorage.getItem("taieri-skill-open")==="0")document.getElementById("skillBox").classList.add("closed");}catch(e){}
onTap(document.getElementById("availHead"),function(){
  var box=document.getElementById("availBox");box.classList.toggle("closed");
  try{localStorage.setItem("taieri-avail-open",box.classList.contains("closed")?"0":"1");}catch(e){}
  fit();
});
try{if(localStorage.getItem("taieri-avail-open")==="0")document.getElementById("availBox").classList.add("closed");}catch(e){}
onTap(document.getElementById("issuesHead"),function(){
  var box=document.getElementById("issuesBox");box.classList.toggle("closed");
  try{localStorage.setItem("taieri-rules-open",box.classList.contains("closed")?"0":"1");}catch(e){}
  fit();
});
try{if(localStorage.getItem("taieri-rules-open")==="1")document.getElementById("issuesBox").classList.remove("closed");}catch(e){}
function setZoom(z){userScale=Math.max(0.4,Math.min(1.5,Math.round(z*20)/20));try{localStorage.setItem("taieri-zoom",String(userScale));}catch(e){}lastFit=null;fit();}
document.getElementById("zoomOut").addEventListener("click",function(){setZoom(userScale-0.1);});
document.getElementById("zoomIn").addEventListener("click",function(){setZoom(userScale+0.1);});
onTap(document.getElementById("prev"),function(){state.mon=addDays(state.mon,-7);openWeek();});
onTap(document.getElementById("next"),function(){state.mon=addDays(state.mon,7);openWeek();});
onTap(document.getElementById("thisWk"),function(){state.mon=curMon();openWeek();});
onTap(document.getElementById("clear"),function(){state.data.assign={};state.pick=null;save();render();});
onTap(document.getElementById("editFleet"),function(){state.editFleet=!state.editFleet;render();});
onTap(document.getElementById("addVan"),function(){
  try{
    var vid="v"+Date.now().toString(36);
    state.cfg.vans=state.cfg.vans.slice();
    state.cfg.vans.push({id:vid,plate:"NEW"+(state.cfg.vans.length+1),col:"silver",type:"van",make:""});
    state.editFleet=true;saveCfg();render();
    setStatus("vehicle added — type the plate",true);
    var inp=document.getElementById("plate-"+vid);if(inp){inp.focus();inp.select();}
  }catch(e){setStatus("error adding vehicle: "+(e&&e.message||e));}
});
onTap(document.getElementById("editDrivers"),function(){state.editDrivers=!state.editDrivers;render();});
onTap(document.getElementById("addDriver"),function(){
  try{
    var nid="d"+Date.now().toString(36);
    state.cfg.drivers=state.cfg.drivers.slice();
    state.cfg.drivers.push({id:nid,name:"New driver",cleared:false});
    state.editDrivers=true;saveCfg();render();
    setStatus("driver added — type the name",true);
    var inp=document.getElementById("drv-"+nid);if(inp){inp.focus();inp.select();}
  }catch(e){setStatus("error adding driver: "+(e&&e.message||e));}
});
onTap(document.getElementById("preset"),function(){
  var out={};
  DAYS.forEach(function(day){
    var ks=Object.keys(PRESET).filter(function(k){return k.split("|")[0]===day;});
    ks.sort(function(x,y){return span(x.split("|")[1],day)[0]-span(y.split("|")[1],day)[0];});
    var perDrv={},fixedIds={};Object.keys(FIXED_VAN).forEach(function(r){fixedIds[FIXED_VAN[r]]=1;});
    var pool=state.cfg.vans.filter(function(v){return !fixedIds[v.id];}),vi=0;
    ks.forEach(function(k){
      var run=k.split("|")[1],drv=PRESET[k];
      if(FIXED_VAN[run]){perDrv[drv]=FIXED_VAN[run];}
      if(!perDrv[drv]){var v=pool[vi++];perDrv[drv]=v?v.id:null;}
      out[k]=perDrv[drv]?{drv:drv,van:perDrv[drv]}:{drv:drv};
    });
  });
  state.data.assign=seedFixed(out);state.pick=null;save();render();
});
onTap(document.getElementById("copyPrev"),function(){
  var src=null;try{var r=localStorage.getItem("taieri-roster-"+key(addDays(state.mon,-7)));if(r)src=JSON.parse(r);}catch(e){}
  if(src&&src.assign){state.data.assign=adopt({assign:JSON.parse(JSON.stringify(src.assign))}).assign;save();render();hint("Last week copied across",2200);}
  else hint("No saved roster for the week before this one",2600);
});

/* ---------- keep the view across a reload or republish ---------- */
(function(){var a=document.getElementById("sc0"),b=document.getElementById("sc1"),lock=false;
  function link(x,y){x.addEventListener("scroll",function(){if(lock)return;lock=true;y.scrollLeft=x.scrollLeft;lock=false;});}
  link(a,b);link(b,a);})();
function sizeTopScroll(){var g=document.getElementById("grid"),w=document.getElementById("sc0w");if(g&&w)w.style.width=g.scrollWidth+"px";}
function viewState(){var sc=document.getElementById("sc1");return {week:key(state.mon),x:window.scrollX,y:window.scrollY,gx:sc?sc.scrollLeft:0,t:Date.now()};}
function saveView(){try{sessionStorage.setItem("taieri-view",JSON.stringify(viewState()));}catch(e){}}
function restoreView(v){
  if(!v)return;
  if(v.week){var d=new Date(v.week+"T00:00:00");if(!isNaN(d)&&key(monday(d))!==key(state.mon)){state.mon=monday(d);openWeek();}}
  function go(){var sc=document.getElementById("sc1");if(sc&&v.gx)sc.scrollLeft=v.gx;window.scrollTo(v.x||0,v.y||0);}
  go();requestAnimationFrame(go);setTimeout(go,150);setTimeout(go,600);
}
var savedView=null;
try{var _sv=JSON.parse(sessionStorage.getItem("taieri-view")||"null");if(_sv&&Date.now()-(_sv.t||0)<6*3600*1000)savedView=_sv;}catch(e){}
if(window.claude&&window.claude.hot&&window.claude.hot.data)savedView=window.claude.hot.data.view||savedView;
try{if(window.claude&&window.claude.hot&&typeof window.claude.hot.snapshot==="function")window.claude.hot.snapshot(function(){return {view:viewState()};});}catch(e){}
var viewT=null;
window.addEventListener("scroll",function(){clearTimeout(viewT);viewT=setTimeout(saveView,150);},{passive:true});
document.addEventListener("scroll",function(ev){if(ev.target&&ev.target.classList&&ev.target.classList.contains("scroll")){clearTimeout(viewT);viewT=setTimeout(saveView,150);}},true);
window.addEventListener("pagehide",saveView);
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden")saveView();});

openWeek();
if(savedView)restoreView(savedView);

/* ---------- fit the whole board to the window ---------- */
var wrapEl=document.querySelector(".wrap"),fitT=null;
var ZOOM_OK=(function(){try{return CSS.supports("zoom","1");}catch(e){return false;}})();
var lastFit=null,userScale=(function(){try{return parseFloat(localStorage.getItem("taieri-zoom"))||1;}catch(e){return 1;}})();
function fit(){
  /* the whole board is laid out at a fixed width and scaled to fill the screen — everything on one screen, nothing cut off */
  var BASE=1500,PAD=32;
  var vw=document.documentElement.clientWidth||window.innerWidth;
  var sc=Math.min((vw-PAD)/BASE,1.6)*userScale;
  var zl=document.getElementById("zoomLab");if(zl)zl.textContent=Math.round(userScale*100)+"%";
  if(lastFit===sc&&ZOOM_OK)return;lastFit=sc;
  wrapEl.style.width=BASE+"px";
  if(ZOOM_OK){
    wrapEl.style.transform="";wrapEl.style.marginBottom="";wrapEl.style.marginLeft="";
    wrapEl.style.zoom=String(sc);ghost.style.zoom=String(sc);
  }else{
    wrapEl.style.zoom="";ghost.style.zoom="";
    wrapEl.style.transformOrigin="top left";wrapEl.style.transform="scale("+sc+")";
    wrapEl.style.marginLeft=Math.max(0,(vw-PAD-BASE*sc)/2)+"px";
    var h=wrapEl.getBoundingClientRect().height;wrapEl.style.marginBottom=(-(wrapEl.offsetHeight-h))+"px";
    ghost.style.transform="scale("+sc+")";
  }
}
var _render=render;
render=function(){
  var sx=window.scrollX,sy=window.scrollY;
  _render();fit();
  if(menuReopen&&!menuEl.hidden)menuReopen();
  if(sy||sx){window.scrollTo(sx,sy);requestAnimationFrame(function(){window.scrollTo(sx,sy);});}
};
window.addEventListener("resize",function(){clearTimeout(fitT);fitT=setTimeout(function(){fit();sizeTopScroll();},80);});
try{new ResizeObserver(function(){clearTimeout(fitT);fitT=setTimeout(fit,80);}).observe(document.documentElement);}catch(e){}
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);
fit();

/* ---------- Claude instruction bar ---------- */
(function(){
  if(!window.claude||!window.claude.use)return;
  window.claude.use("sample").then(function(sample){
    if(!sample)return;
    var bar=document.getElementById("ask"),inp=document.getElementById("askIn"),go=document.getElementById("askGo"),
        stop=document.getElementById("askStop"),out=document.getElementById("askOut");
    bar.hidden=false;
    var ctl=null;
    function boardText(){
      var lines=[];
      DAYS.forEach(function(day){
        slots(day).forEach(function(run){
          var a=get(day,run);
          lines.push(day+" "+run+(W[run].label?" ("+W[run].label+")":"")+" ["+winText(run,day)+extraText(day,run)+"]: driver="+(a.drv?a.drv+" ("+DNAME[a.drv]+")":"-")+" van="+(a.van?plateOf(a.van):"-")+(W[run].novan?XD.slice(0,(W[run].slots||2)-1).map(function(f,i){return " driver"+(i+2)+"="+(a[f]?a[f]+" ("+DNAME[a[f]]+")"+(a[stKey(f)]?" start "+a[stKey(f)]+"am":""):"-");}).join("")+(a.st?" start1 "+a.st+"am":""):"")+" trainee="+(a.tr?a.tr+" ("+DNAME[a.tr]+")":"-")+" addons="+((a.add&&a.add.length)?a.add.join("+"):"-"));
        });
      });
      return lines.join("\n");
    }
    function prompt(instr){
      return [
"You are editing a weekly courier roster for Taieri Post (Dunedin, NZ). Apply the instruction below to the board and reply with ONLY a JSON object: {\"ops\":[...],\"note\":\"one short sentence on what you did or why you couldn't\"}.",
"Each op is {\"week\":<optional, see Dates>,\"day\":\"Mon\"..\"Sat\",\"run\":<run code>,\"drv\":<driver code>|null,\"van\":<plate>|null,\"tr\":<driver code of a TRAINEE riding along>|null,\"drv2\"/\"drv3\"/\"drv4\":<extra drivers, Support rows only (Support 1 takes up to 4 people, Support 2 up to 2)>|null,\"add\":[<addon ids>]}. Include only the fields you are changing; null clears that field; \"add\" is the COMPLETE new add-on list for that run-day (empty array clears). Add-on ids: "+ADDONS.map(function(a){return a.id+" = "+a.name+(a.task?" (task inside the run, "+a.when+", no extra time)":" (+"+a.min+" min, extends the run's finish time)");}).join(", ")+". Receivers and pick-ups normally sit on RSB, except Harbour Fish which is normally on PCB."+(TW.filter(function(r){return /^tw_/.test(twAidOf(r));}).length?" Timing add-ons (tw_…) only go on these runs and days, and on one run per day: "+TW.filter(function(r){return /^tw_/.test(twAidOf(r));}).map(function(r){return twAidOf(r)+" = "+r.name+" ("+twWhere(r)+")";}).join("; ")+".":"")+" Waihola Store (waihola) is a daily stop normally on FLY (Flyer); TUA or DB (D>B) can take it instead; keep it on exactly one of those runs each day they go out. A run only exists on the days listed below — never invent others.",
"Rules: a driver or a van may take any number of runs in a week, and more than one in a day, but never two runs whose times overlap. Prefer drivers signed off on a run; someone still training on it should go as trainee (tr) with a signed-off driver. Run experience (driver: runs): "+state.cfg.drivers.map(function(d){var y=[],t=[];SKILL_RUNS.forEach(function(s){var v=(state.cfg.skills||{})[d.id+"|"+s];if(v==="yes")y.push(s);else if(v==="tr")t.push(s);});return d.name+": "+(y.length?y.join(","):"none")+(t.length?" (training "+t.join(",")+")":"");}).join("; ")+". The operations document prefers at most one hard run (T, RSB, PCB, RAM) per driver per day. Every rostered run should have both a driver and a van. Do not move things the instruction didn't ask about.",
"On Saturday PCB and RSB go out as two separate rounds, each with its own driver and van. There are no receivers or pick-ups on Saturday (never add rose, sb, fish, pc, digi or fonterra on Sat).",
"Training days (the run goes out but it is a training run, hours count as training): "+(function(){var t=state.cfg.train||{};var k=Object.keys(t).filter(function(x){return t[x];});return k.length?k.map(function(x){var p=x.split("|");return p[0]+" "+RL(p[1]);}).join(", "):"none";})()+".",
"Standing allocations: "+Object.keys(FIXED_VAN).map(function(r){return plateOf(FIXED_VAN[r])+" is the "+r+" ("+W[r].name+") van every week";}).join("; ")+". S (Suburbs) and T (Town) are both TGE runs and run at the same time, so they need different vans.",
"Drivers (code = name): "+DRIVERS.map(function(d){return d[0]+" = "+d[1];}).join(", "),
"Driver availability this week (only where it differs from the whole day 05:00–18:00): "+(function(){var out=[];state.cfg.drivers.forEach(function(d){DAYS.forEach(function(day){var av=availOf(d.id,day);if(!av)out.push(d.name+" not available "+day);else if(av[0]!==A0||av[1]!==A1)out.push(d.name+" "+day+" "+fmt(av[0])+"–"+fmt(av[1]));});});return out.length?out.join("; "):"none";})()+". Never roster someone outside their availability. A trainee (tr) is on the road for the whole run too: they count as busy for that time and can't be placed on another run that overlaps.",
"Vans (plate, colour, make): "+state.cfg.vans.map(function(v){return v.plate+" ("+v.col+(v.make?", "+v.make:"")+")";}).join(", "),
"Dates: today is "+key(new Date())+". The board is showing the week starting Monday "+key(state.mon)+"; next week starts "+key(addDays(state.mon,7))+", the week after "+key(addDays(state.mon,14))+". An op changes the displayed week unless it carries \"week\":\"YYYY-MM-DD\" (any date inside the week you mean, or \"next\", \"+2\"). Runs, drivers, vans and rules are the same every week; the board below is the displayed week only — other weeks may be empty, so give complete assignments for them.",
"Board for the week of "+short(state.mon)+" "+state.mon.getFullYear()+" (one line per run-day, times are fixed):",
boardText(),
"Instruction: "+instr
      ].join("\n\n");
    }
    function weekKeyFrom(str){
      if(!str)return null;str=String(str).trim().toLowerCase();
      if(str==="this"||str==="current")return key(state.mon);
      var m=str.match(/^(next|\+)\s*(\d*)$/);if(m)return key(addDays(state.mon,7*(parseInt(m[2]||"1",10)||1)));
      var d=new Date(str.length===10?str+"T00:00:00":str);if(isNaN(d))return null;return key(monday(d));
    }
    function loadWeek(k){
      var local=null;try{var r=localStorage.getItem("taieri-roster-"+k);if(r)local=JSON.parse(r);}catch(e){}
      var pServer=Promise.resolve(null);
      try{var ref=DB&&DB.doc("roster/"+k);if(ref&&typeof ref.get==="function")pServer=ref.get().then(function(sn){return (sn&&sn.exists)?clone(sn.data()):null;}).catch(function(){return null;});}catch(e){}
      return pServer.then(function(server){
        var pick=null;
        if(local&&server)pick=((server.updated||0)>(local.updated||0))?server:local;else pick=local||server;
        var data=adopt(pick||{assign:{}});
        if(!pick)seedFixed(data.assign);
        return data;
      });
    }
    function writeWeek(k,data){
      data.updated=Date.now();
      try{localStorage.setItem("taieri-roster-"+k,JSON.stringify(data));}catch(e){}
      if(DB)return DB.doc("roster/"+k).set({assign:clone(data.assign),notes:data.notes||"",updated:data.updated}).catch(function(){setStatus("NOT saved to the cloud — week of "+k);});
      return Promise.resolve();
    }
    function applyOp(o,assign,byPlate,bad){
      var day=String(o.day||"").slice(0,3),run=String(o.run||"").toUpperCase();
      day=day.charAt(0).toUpperCase()+day.slice(1).toLowerCase();
      if(!W[run]||!win(run,day)){bad.push(day+" "+run);return false;}
      var cur=norm(assign[day+"|"+run]),next=Object.assign({},cur),touched=false;["add","tr","drv2","drv3","drv4"].forEach(function(f){if(!next[f])delete next[f];});
      if("tr" in o){var tv=o.tr===null?null:String(o.tr).toUpperCase();if(tv&&!DNAME[tv]){var tf=DRIVERS.filter(function(d){return d[1].toUpperCase()===tv;})[0];tv=tf?tf[0]:null;}if(tv===null)delete next.tr;else if(tv)next.tr=tv;touched=true;}
      if("drv" in o){var dv=o.drv===null?null:String(o.drv).toUpperCase();if(dv&&!DNAME[dv]){var f=DRIVERS.filter(function(d){return d[1].toUpperCase()===dv;})[0];dv=f?f[0]:null;}if(dv===null)delete next.drv;else if(dv)next.drv=dv;touched=true;}
      XD.forEach(function(fx){if(!(fx in o))return;var dv2=o[fx]===null?null:String(o[fx]).toUpperCase();if(dv2&&!DNAME[dv2]){var f2=DRIVERS.filter(function(d){return d[1].toUpperCase()===dv2;})[0];dv2=f2?f2[0]:null;}if(dv2===null)delete next[fx];else if(dv2)next[fx]=dv2;touched=true;});
      if("add" in o&&Array.isArray(o.add)){var ids=o.add.map(function(x){x=String(x).toLowerCase();var hit=ADDONS.filter(function(a){return a.id===x||a.name.toLowerCase()===x||a.short.toLowerCase()===x;})[0];return hit?hit.id:null;}).filter(function(x){return x&&!satBlocked(day,x);});next.add=ids.length?ids:undefined;if(!next.add)delete next.add;touched=true;}
      if("van" in o){var vn=o.van===null?null:byPlate[String(o.van).toUpperCase().replace(/\s+/g,"")];if(o.van===null)delete next.van;else if(vn)next.van=vn;else bad.push("van "+o.van);touched=true;}
      if(!touched)return false;
      var k=day+"|"+run;
      if(!anyDrv(next)&&!next.van&&!next.add&&!next.tr)delete assign[k];else assign[k]=next;
      return true;
    }
    function apply(res){
      var ops=(res&&res.ops)||[],n=0,bad=[],weeks={};
      var byPlate={};state.cfg.vans.forEach(function(v){byPlate[v.plate.toUpperCase()]=v.id;});
      var here=key(state.mon);
      ops.forEach(function(o){
        var wk=o.week?weekKeyFrom(o.week):here;
        if(!wk){bad.push("week "+o.week);return;}
        (weeks[wk]=weeks[wk]||[]).push(o);
      });
      var jobs=[];
      Object.keys(weeks).forEach(function(wk){
        if(wk===here){
          weeks[wk].forEach(function(o){if(applyOp(o,state.data.assign,byPlate,bad))n++;});
        }else{
          jobs.push(loadWeek(wk).then(function(data){
            var c=0;weeks[wk].forEach(function(o){if(applyOp(o,data.assign,byPlate,bad))c++;});
            n+=c;
            if(c)return writeWeek(wk,data).then(function(){return wk;});
            return null;
          }));
        }
      });
      if(weeks[here]&&weeks[here].length){save();render();}
      return Promise.all(jobs).then(function(done){
        var other=done.filter(Boolean);
        return {n:n,bad:bad,other:other};
      });
    }
    function busy(on){go.disabled=on;inp.disabled=on;stop.hidden=!on;}
    function run(){
      var q=inp.value.trim();if(!q)return;
      ctl=new AbortController();busy(true);out.className="ask-out";out.textContent="Thinking…";
      sample.json(prompt(q),{modelTier:"quick",cache:false,signal:ctl.signal}).then(function(res){
        return apply(res).then(function(r){
          out.textContent=(res&&res.note?res.note+" ":"")+(r.n?r.n+" change"+(r.n===1?"":"s")+" applied.":"Nothing changed.")+
            (r.other.length?" Also changed the week"+(r.other.length>1?"s":"")+" of "+r.other.map(function(k){var d=new Date(k+"T00:00:00");return short(d);}).join(", ")+" — use the arrows to see them.":"")+
            (r.bad.length?" Skipped: "+r.bad.join(", ")+".":"");
          inp.value="";
        });
      }).catch(function(e){
        var c=e&&e.code;
        out.className="ask-out err";
        if(c==="cancelled")out.textContent="Stopped.";
        else if(c==="not_granted"||c==="sampling_disabled"||c==="not_declared"||c==="capability_disabled"){bar.hidden=true;}
        else if(c==="rate_limited")out.textContent="Claude is busy — try again in a moment.";
        else if(c==="invalid_json")out.textContent="Didn't get a usable answer — try wording it more directly.";
        else out.textContent="That didn't go through — "+(e&&(e.message||c)||"try again")+".";
      }).then(function(){busy(false);ctl=null;});
    }
    go.addEventListener("click",run);
    inp.addEventListener("keydown",function(ev){if(ev.key==="Enter"){ev.preventDefault();run();}});
    stop.addEventListener("click",function(){if(ctl)ctl.abort();});
  }).catch(function(){});
})();

/* ---------- week approval: email NZ Post runs to Alejandro (admin) ---------- */
var ADMIN_EMAIL="alejandromartinezdj@outlook.com";
var APPR=null,apprUnsub=null,apprWk=null;
var NZP_RUNS=["FLY","TUA","RAM","LAW","DB","PCB","RSB"],NZP_NAME={FLY:"D5636a",TUA:"D5636",RAM:"Z5636",LAW:"PLAD01",DB:"D>B",PCB:"PPCS63",RSB:"PPCS64"};
function watchAppr(){
  if(apprUnsub){try{apprUnsub();}catch(e){}apprUnsub=null;}
  APPR=null;apprWk=key(state.mon);renderAppr();
  if(!DB)return;
  try{apprUnsub=DB.doc("approvals/"+apprWk).onSnapshot(function(snap){if(apprWk!==key(state.mon))return;APPR=(snap&&snap.exists)?snap.data():null;renderAppr();},function(){});}catch(e){}
}
function renderAppr(msg){
  var b=document.getElementById("approveWk"),l=document.getElementById("apprLab");if(!b)return;
  b.style.display=STAFF?"none":"";
  if(APPR&&APPR.approvedAt){
    b.textContent="Roster approved ✓";b.classList.add("on");
    l.textContent=msg||("approved "+fmtD(APPR.approvedAt.slice(0,10))+(APPR.sentAt?" · emailed to Alejandro":" · email not sent"));
  }else{b.textContent="✓ Approve roster";b.classList.remove("on");l.textContent=msg||"";}
  renderComm();
}
function nzpRows(){
  var rows=[];
  DAYS.forEach(function(d,i){
    var dt=addDays(state.mon,i);
    slots(d).forEach(function(run){
      if(NZP_RUNS.indexOf(run)<0||!espan(run,d))return;var a=get(d,run);if(!a.drv)return;
      var who=[a.drv].concat(XD.map(function(f){return a[f];}).filter(Boolean)).map(function(x){return drvName(x);}).join(" + ");
      var main=[a.drv].concat(XD.map(function(f){return a[f];}).filter(Boolean)).map(function(x){return drvName(x);}).join(" / ");
      if(a.tr)who+=" (training: "+drvName(a.tr)+")";
      var ad=a.add||[];
      var serial=Math.round((Date.UTC(dt.getFullYear(),dt.getMonth(),dt.getDate())-Date.UTC(1899,11,30))/864e5);
      rows.push({date:("0"+dt.getDate()).slice(-2)+"/"+("0"+(dt.getMonth()+1)).slice(-2)+"/"+dt.getFullYear(),day:d,run:NZP_NAME[run],driver:who,
        serial:serial,pday:{Tue:"Tues",Thu:"Thurs"}[d]||d,pdriver:main,note:a.tr?"Training: "+drvName(a.tr):"",
        airport:ad.indexOf("airport")>=0,milton:run==="DB"||ad.indexOf("milton")>=0,balclutha:ad.indexOf("balclutha")>=0,owaka:ad.indexOf("owaka")>=0,wh:run==="PCB"||run==="RSB"});
    });
  });
  return rows;
}
function approveWeek(){
  var b=document.getElementById("approveWk");
  if(STAFF||!DB)return;
  if(APPR&&APPR.approvedAt&&b.dataset.arm!=="1"){b.dataset.arm="1";b.textContent="Tap again to re-send";setTimeout(function(){b.dataset.arm="";renderAppr();},4000);return;}
  b.dataset.arm="";flushAll();
  var rows=nzpRows(),wk=key(state.mon),ref=DB.doc("approvals/"+wk);
  var lab=short(state.mon)+" – "+short(addDays(state.mon,6));
  var rec={approvedAt:new Date().toISOString(),commAssign:clone(state.data.assign),runs:rows.length,perfRows:rows.map(function(r){return {serial:r.serial,day:r.pday,run:r.run,driver:r.pdriver,note:r.note,airport:r.airport,milton:r.milton,balclutha:r.balclutha,owaka:r.owaka,wh:r.wh};}),perfDone:false};
  b.disabled=true;renderAppr("approving…");
  ref.set(rec).then(function(){
    if(!MCP){renderAppr("approved · email NOT sent (Outlook not connected to this page)");return;}
    var yn=function(v){return v?"Yes":"";};
    var tb="<table border=\"1\" cellpadding=\"4\" cellspacing=\"0\"><tr><th>Date</th><th>Day</th><th>Run type</th><th>Driver</th><th>Airport</th><th>Milton</th><th>Balclutha</th><th>Owaka</th></tr>"+rows.map(function(r){return "<tr><td>"+r.date+"</td><td>"+r.day+"</td><td>"+escH(r.run)+"</td><td>"+escH(r.driver)+"</td><td>"+yn(r.airport)+"</td><td>"+yn(r.milton)+"</td><td>"+yn(r.balclutha)+"</td><td>"+yn(r.owaka)+"</td></tr>";}).join("")+"</table>";
    var body="<p>Hi Alejandro,</p><p>The roster for <b>"+escH(lab)+"</b> is approved. Here are the NZ Post runs for the Performance sheet (date, run type and driver):</p>"+tb+"<p>Thanks,<br>Jeremy<br>Taieri Post Limited</p>";
    return MCP.callTool("Microsoft 365","outlook_send_mail",{to:[ADMIN_EMAIL],subject:"Approved roster – NZ Post runs "+lab,body:body,bodyType:"html"})
      .then(function(){rec.sentAt=new Date().toISOString();rec.sentTo=ADMIN_EMAIL;return ref.set(rec);})
      .catch(function(e){renderAppr("approved · email didn't send: "+(e&&(e.message||e.code)||"error"));});
  }).catch(function(e){renderAppr("NOT approved — "+(e&&(e.message||e.code)||"write failed"));})
  .then(function(){b.disabled=false;});
}
document.getElementById("approveWk").addEventListener("click",approveWeek);

/* ---------- roster changes after approval: save & email, driver portal notices, confirmations ----------
   approvals/<week>.commAssign = the roster as last communicated. Anything different (from today on) is "non comm".
   Sending writes notices/<id> (copied to the driver portals and the scorecard by the scorecard sync task),
   emails Alejandro the NZ Post rows that changed and each affected driver their own changes, and starts that sync.
   Drivers confirm on their portal; the sync copies confirmations back into notices/<id>.reads. */
var SYNC_TRIGGER="trig_011S4FFNbymK692wZXxnHJCP";
var NOTICES=[],UNC={},noticeUnsub=null;
function perfOf(rows){return rows.map(function(r){return {serial:r.serial,day:r.pday,run:r.run,driver:r.pdriver,note:r.note,airport:r.airport,milton:r.milton,balclutha:r.balclutha,owaka:r.owaka,wh:r.wh};});}
function serialDate(s){var d=new Date(Date.UTC(1899,11,30)+s*864e5);return ("0"+d.getUTCDate()).slice(-2)+"/"+("0"+(d.getUTCMonth()+1)).slice(-2)+"/"+d.getUTCFullYear();}
/* add-ons always go last, after this separator, so a change to add-ons only can be worded as add-ons added / removed (not as if they were runs) */
var ADD_SEP=" · add-ons: ";
function addTxt(a){return (a.add&&a.add.length)?ADD_SEP+a.add.map(function(x){return ADDON[x]?ADDON[x].name:x;}).join(", "):"";}
function addChangeTxt(o,n){
  var ob=o.split(ADD_SEP),nb=n.split(ADD_SEP);if(ob[0]!==nb[0])return null;
  var oa=ob[1]?ob[1].split(", "):[],na=nb[1]?nb[1].split(", "):[];
  var ad=na.filter(function(x){return oa.indexOf(x)<0;}),rm=oa.filter(function(x){return na.indexOf(x)<0;}),p=[];
  if(ad.length)p.push("add-on"+(ad.length>1?"s":"")+" added: "+ad.join(", "));
  if(rm.length)p.push("add-on"+(rm.length>1?"s":"")+" removed: "+rm.join(", "));
  return p.length?nb[0]+" — "+p.join("; "):null;
}
/* every driver's slots in a roster, from today on: {drvId: {"Day|RUN": "description"}} */
function drvEntries(assign){
  var out={},today=todayKey();
  DAYS.forEach(function(day,i){
    if(key(addDays(state.mon,i))<today)return;
    slots(day).forEach(function(run){
      var a=norm(assign[day+"|"+run]),k=day+"|"+run,base=RL(run)+" "+winShort(run,day);
      ["drv","drv2","drv3","drv4"].forEach(function(f){
        var id=a[f];if(!id)return;
        var st=(W[run].novan&&a[stKey(f)])?" from "+fmtSt(a[stKey(f)])+"am":"";
        (out[id]=out[id]||{})[k]=base+st+(a.van?" ("+plateOf(a.van)+")":"")+(a.tr?" · trainee "+drvName(a.tr):"")+addTxt(a);
      });
      if(a.tr&&a.tr!==a.drv)(out[a.tr]=out[a.tr]||{})[k]=base+" — training with "+(a.drv?drvName(a.drv):"(no driver yet)");
    });
  });
  return out;
}
function commItems(){
  if(!APPR||!APPR.approvedAt)return [];
  var was=drvEntries(APPR.commAssign||{}),now=drvEntries(state.data.assign),items=[];
  var ids={};Object.keys(was).forEach(function(x){ids[x]=1;});Object.keys(now).forEach(function(x){ids[x]=1;});
  Object.keys(ids).forEach(function(id){
    var o=was[id]||{},n=now[id]||{},ks={};Object.keys(o).forEach(function(x){ks[x]=1;});Object.keys(n).forEach(function(x){ks[x]=1;});
    Object.keys(ks).forEach(function(k){
      if(o[k]===n[k])return;
      var day=k.split("|")[0],dt=addDays(state.mon,DAYS.indexOf(day)),lab=day+" "+short(dt)+": ";
      var ac=(o[k]&&n[k])?addChangeTxt(o[k],n[k]):null;
      var txt=ac?lab+ac:(!o[k]?lab+"now on "+n[k]:(!n[k]?lab+"no longer on "+RL(k.split("|")[1])+" (was "+o[k]+")":lab+n[k]+" (was "+o[k]+")"));
      items.push({drv:id,name:drvName(id),key:k,day:day,date:key(dt),text:txt});
    });
  });
  items.sort(function(a,b){return (a.name.localeCompare(b.name))||(a.date<b.date?-1:a.date>b.date?1:0);});
  return items;
}
function nzpChanges(){
  if(!APPR||!APPR.approvedAt)return [];
  var cur=perfOf(nzpRows()),old=APPR.perfRows||[],om={},nm={},ks={},out=[];
  old.forEach(function(r){var k=r.serial+"|"+r.run;om[k]=r;ks[k]=1;});
  cur.forEach(function(r){var k=r.serial+"|"+r.run;nm[k]=r;ks[k]=1;});
  var sig=function(r){return r?[r.driver,r.note,r.airport,r.milton,r.balclutha,r.owaka].join("|"):"";};
  Object.keys(ks).sort().forEach(function(k){
    var o=om[k],n=nm[k];if(sig(o)===sig(n))return;
    var r=n||o,ad=[];if(n){if(n.airport)ad.push("Airport");if(n.milton)ad.push("Milton");if(n.balclutha)ad.push("Balclutha");if(n.owaka)ad.push("Owaka");}
    out.push({date:serialDate(r.serial),day:r.day,run:r.run,was:o?o.driver+(o.note?" ("+o.note+")":""):"—",now:n?n.driver+(n.note?" ("+n.note+")":""):"not running",adds:ad.join(", ")});
  });
  return out;
}
/* Past changes are historic (29 Oct 2026, Jeremy): once the changed run has STARTED, an unconfirmed change is no
   longer chased. It drops off the red cells, the "not confirmed" counts and the confirmations list (shown there as
   "run started"). Past = the item's date is before today, or it's today and the run's start time has passed. */
function itemStart(it){
  var st=null,r=String(it.key||"").split("|")[1];
  try{if(r&&W[r]&&it.day){var w=win(r,it.day);if(w&&w.length)st=w[0][0];}}catch(e){}
  if(st==null){var m=String(it.text||"").match(/(\d{1,2})(?::(\d{2}))?\s*[\u2013-]\s*\d{1,2}/);if(m)st=(+m[1])*60+(+(m[2]||0));}
  return st;
}
function itemPast(it){
  if(!it||!it.date)return false;var t=todayKey();
  if(it.date<t)return true;if(it.date>t)return false;
  var st=itemStart(it);if(st==null)return false;
  var d=new Date();return d.getHours()*60+d.getMinutes()>=st;
}
function uncKeys(){
  var out={},wk=key(state.mon);
  (NOTICES||[]).forEach(function(n){
    if(n.week!==wk)return;var rd=n.reads||{},mk=n.marks||{};
    (n.items||[]).forEach(function(it){if(rd[it.name]||mk[markKey(it)]||itemPast(it))return;var L=out[it.key]=out[it.key]||[];if(L.indexOf(it.name)<0)L.push(it.name);});
  });
  /* a later change to the same slot that the driver has confirmed covers the earlier one only if it's for the same person, which is already handled above */
  return out;
}
/* Confirm / Dismiss from the board (29 Oct 2026): Jeremy can take the red off a change himself.
   Stored per change on the notice: notices/<id>.marks["<name>|<Day|RUN>"] = {s:"ok"|"dismissed", at, by:"runboard"}.
   reads (the driver's own portal confirmation) is never touched here. */
function markKey(it){return it.name+"|"+it.key;}
function openItems(filter){
  var wk=key(state.mon),out=[];
  (NOTICES||[]).forEach(function(n){
    if(n.week!==wk||!n.id)return;var rd=n.reads||{},mk=n.marks||{};
    (n.items||[]).forEach(function(it){if(rd[it.name]||mk[markKey(it)]||itemPast(it))return;if(filter(it,n))out.push({nid:n.id,it:it});});
  });
  return out;
}
function setMarks(list,s){
  /* list: [{nid,it}] · s: "ok" | "dismissed" | null (undo) */
  if(!DB||!list.length)return Promise.resolve();
  autoSync();
  var by={};list.forEach(function(x){(by[x.nid]=by[x.nid]||[]).push(x.it);});
  var now=new Date().toISOString();
  /* show it straight away (NOTICES holds our own clones, so they can be changed); the snapshot confirms it */
  try{
    NOTICES=(NOTICES||[]).map(function(n){
      if(!by[n.id])return n;var c=clone(n);c.marks=Object.assign({},c.marks||{});
      by[n.id].forEach(function(it){if(s)c.marks[markKey(it)]={s:s,at:now,by:"runboard"};else delete c.marks[markKey(it)];});
      return c;
    });
    render();
  }catch(e){}
  setStatus("saving…");
  return Promise.all(Object.keys(by).map(function(nid){
    var ref=DB.doc("notices/"+nid);
    if(s){
      /* update merges nested objects, so only the new keys need sending */
      var add={};by[nid].forEach(function(it){add[markKey(it)]={s:s,at:now,by:"runboard"};});
      return ref.update({marks:add});
    }
    /* undo: update can't remove a key, so write the whole document back without it */
    return ref.get().then(function(snap){
      if(!snap||!snap.exists)return;
      var v=clone(snap.data()||{});v.marks=Object.assign({},v.marks||{});
      by[nid].forEach(function(it){delete v.marks[markKey(it)];});
      return ref.set(v);
    });
  })).then(function(){setStatus((s==="ok"?"confirmed":(s==="dismissed"?"dismissed":"undone"))+" "+stamp(),true);},
    function(e){setStatus("NOT saved — "+(e&&(e.message||e.code)||"write failed"));});
}
function openUncMenu(anchor,day,run,names){
  var k=day+"|"+run;
  menuEl.innerHTML="";
  var hd=document.createElement("div");hd.className="mh";hd.textContent="Not confirmed · "+RL(run)+" "+day;menuEl.appendChild(hd);
  names.forEach(function(nm){
    var row=document.createElement("div");row.className="ur";
    var b=document.createElement("b");b.textContent=nm;row.appendChild(b);
    [["ok","✓ Confirm","Driver has seen this change (told you in person, by text…)"],["dismissed","Dismiss","Take the red off without a confirmation"]].forEach(function(o){
      var btn=document.createElement("button");btn.type="button";btn.className="btn sm"+(o[0]==="ok"?" ok":"");btn.textContent=o[1];btn.title=o[2];
      btn.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
      btn.addEventListener("click",function(ev){ev.stopPropagation();closeMenu();setMarks(openItems(function(it){return it.key===k&&it.name===nm;}),o[0]);});
      row.appendChild(btn);
    });
    menuEl.appendChild(row);
  });
  if(names.length>1){
    var all=document.createElement("div");all.className="ur";
    var ab=document.createElement("b");ab.textContent="Everyone";all.appendChild(ab);
    [["ok","✓ Confirm all"],["dismissed","Dismiss all"]].forEach(function(o){
      var btn=document.createElement("button");btn.type="button";btn.className="btn sm"+(o[0]==="ok"?" ok":"");btn.textContent=o[1];
      btn.addEventListener("pointerdown",function(ev){ev.stopPropagation();});
      btn.addEventListener("click",function(ev){ev.stopPropagation();closeMenu();setMarks(openItems(function(it){return it.key===k&&names.indexOf(it.name)>=0;}),o[0]);});
      all.appendChild(btn);
    });
    menuEl.appendChild(all);
  }
  menuEl.hidden=false;
  var r=anchor.getBoundingClientRect(),mw=menuEl.offsetWidth,mh=menuEl.offsetHeight;
  var x=r.left,y=r.bottom+4;
  if(x+mw>window.innerWidth-8)x=window.innerWidth-mw-8;
  if(y+mh>window.innerHeight-8)y=r.top-mh-4;
  menuEl.style.left=Math.max(8,x)+"px";menuEl.style.top=Math.max(8,y)+"px";
}
function commMsg(t,bad){var l=document.getElementById("commLab");if(l){l.textContent=t||"";l.classList.toggle("bad",!!bad);}}
var COMM_NOTE="";
function renderComm(msg){
  var b=document.getElementById("commWk");if(!b)return;
  if(msg!==undefined)COMM_NOTE=msg;
  var show=!STAFF&&!!(APPR&&APPR.approvedAt);
  b.hidden=!show;if(!show){commMsg("");return;}
  if(b.dataset.busy==="1")return;
  var n=commItems().length,z=nzpChanges().length;
  if(n||z){
    b.className="btn comm non";b.textContent="NON COMM · Save & email changes";
    commMsg(COMM_NOTE||((n?n+" driver change"+(n===1?"":"s"):"")+(n&&z?" · ":"")+(z?z+" NZ Post row"+(z===1?"":"s"):"")+" not sent yet"),!COMM_NOTE);
  }else{
    b.className="btn comm ok";b.textContent="✓ Changes communicated";
    var at=APPR.commAt||APPR.approvedAt;
    commMsg(COMM_NOTE||(at?"last sent "+fmtD(at.slice(0,10))+" "+new Date(at).toTimeString().slice(0,5):""));
  }
}
function fireSync(){
  if(!MCP)return Promise.reject({message:"not connected"});
  return MCP.callTool("Claude Code Remote","fire_trigger",{trigger_id:SYNC_TRIGGER});
}
function sendChanges(){
  var b=document.getElementById("commWk");
  if(STAFF||!DB||!APPR||!APPR.approvedAt||b.dataset.busy==="1")return;
  if(flushWeek)flushWeek();
  var wk=key(state.mon),items=commItems(),nz=nzpChanges();
  if(!items.length&&!nz.length){renderComm("nothing new to send");return;}
  var now=new Date().toISOString(),nid=wk+"_"+Date.now(),notes=[];
  var names=[];items.forEach(function(it){if(names.indexOf(it.name)<0)names.push(it.name);});
  var lab=short(state.mon)+" – "+short(addDays(state.mon,6));
  b.dataset.busy="1";b.disabled=true;b.textContent="Sending…";commMsg("saving…");
  var p=items.length?DB.doc("notices/"+nid).set({id:nid,week:wk,at:now,names:names,items:items,reads:{}}):Promise.resolve();
  p.then(function(){
    var upd={commAssign:clone(state.data.assign),commAt:now};
    if(nz.length){var rows=nzpRows();upd.perfRows=perfOf(rows);upd.runs=rows.length;upd.perfDone=false;}
    return DB.doc("approvals/"+wk).update(upd);
  }).then(function(){
    if(!MCP){notes.push("saved, but emails NOT sent (Outlook isn't connected to this page)");return;}
    var jobs=[],byDrv={};
    items.forEach(function(it){(byDrv[it.drv]=byDrv[it.drv]||[]).push(it);});
    Object.keys(byDrv).forEach(function(id){
      var to=EMAILS[id],first=drvName(id).split(" ")[0];
      if(!to){notes.push("no email for "+drvName(id));return;}
      var body="<p>Hi "+escH(first)+",</p><p>Your roster for the week of <b>"+escH(lab)+"</b> has changed:</p><ul>"+byDrv[id].map(function(it){return "<li>"+escH(it.text)+"</li>";}).join("")+"</ul><p>Please confirm you've seen this: <a href=\""+escH("https://wa.me/?text="+encodeURIComponent("#GOTIT "+nid.slice(-5)))+"\"><b>Tap here to confirm in WhatsApp</b></a></p><p>It opens WhatsApp with <b>#GOTIT "+escH(nid.slice(-5))+"</b> typed. Pick <b>TP Works Comms</b> and send.</p><p>Thanks,<br>Jeremy<br>Taieri Post Limited</p>";
      jobs.push(MCP.callTool("Microsoft 365","outlook_send_mail",{to:[to],subject:"Roster change – week of "+lab,body:body,bodyType:"html"}).then(function(){return 1;},function(){notes.push("email to "+first+" failed");return 0;}));
    });
    if(nz.length){
      var tb="<table border=\"1\" cellpadding=\"4\" cellspacing=\"0\"><tr><th>Date</th><th>Day</th><th>Run type</th><th>Was</th><th>Now</th><th>Add-ons</th></tr>"+nz.map(function(r){return "<tr><td>"+r.date+"</td><td>"+escH(r.day)+"</td><td>"+escH(r.run)+"</td><td>"+escH(r.was)+"</td><td><b>"+escH(r.now)+"</b></td><td>"+escH(r.adds)+"</td></tr>";}).join("")+"</table>";
      var abody="<p>Hi Alejandro,</p><p>There are changes to the approved roster for <b>"+escH(lab)+"</b>. Here are the NZ Post runs that changed, for the Performance sheet:</p>"+tb+"<p>Thanks,<br>Jeremy<br>Taieri Post Limited</p>";
      jobs.push(MCP.callTool("Microsoft 365","outlook_send_mail",{to:[ADMIN_EMAIL],subject:"Roster changes – NZ Post runs "+lab,body:abody,bodyType:"html"}).then(function(){return 1;},function(){notes.push("email to Alejandro failed");return 0;}));
    }
    return Promise.all(jobs).then(function(r){var s=r.reduce(function(t,x){return t+x;},0);notes.unshift(s+" email"+(s===1?"":"s")+" sent");});
  }).then(function(){
    return fireSync().then(function(){notes.push("portals & scorecard updating");},function(){notes.push("scorecard sync didn't start — it runs on its own later");});
  }).then(function(){
    b.dataset.busy="";b.disabled=false;renderComm(notes.join(" · "));
    setTimeout(function(){COMM_NOTE="";renderComm();},20000);
  },function(e){
    b.dataset.busy="";b.disabled=false;renderComm("NOT sent — "+(e&&(e.message||e.code)||"write failed"));
  });
}
document.getElementById("commWk").addEventListener("click",sendChanges);

function watchNotices(){
  var db=DB||LDB;
  if(noticeUnsub||!db||STAFF)return;
  try{noticeUnsub=db.collection("notices").orderBy("at","desc").limit(300).onSnapshot(function(qs){
    NOTICES=qs.docs.map(function(d){return clone(d.data()||{});});render();   /* clone: delivered snapshots are frozen */
  },function(){});}catch(e){}
}
function nzTime(iso){var d=new Date(iso);return fmtD(key(d))+" "+d.toTimeString().slice(0,5);}
function renderNotices(){
  var box=document.getElementById("noticeBox");if(!box)return;
  var wk=key(state.mon),list=(NOTICES||[]).filter(function(n){return n.week===wk;});
  box.hidden=STAFF||!(NOTICES||[]).length;if(box.hidden)return;
  var inn=document.getElementById("noticeIn");inn.innerHTML="";
  if(!list.length){var e0=document.createElement("p");e0.className="lempty";e0.textContent="No roster changes sent for this week. Tap History for earlier weeks.";inn.appendChild(e0);}
  var waiting={};
  list.slice().reverse().forEach(function(n){
    var rd=n.reads||{},c=document.createElement("div");c.className="ntc";
    var h=document.createElement("div");h.className="ntc-h";h.textContent="Sent "+nzTime(n.at);c.appendChild(h);
    var mk=n.marks||{};
    (n.names||[]).forEach(function(nm){
      var its=(n.items||[]).filter(function(it){return it.name===nm;});if(!its.length)return;
      var open=rd[nm]?[]:its.filter(function(it){return !mk[markKey(it)]&&!itemPast(it);});
      var marked=rd[nm]?[]:its.filter(function(it){return mk[markKey(it)];});
      var past=rd[nm]?[]:its.filter(function(it){return !mk[markKey(it)]&&itemPast(it);});
      var done=!open.length;
      var p=document.createElement("div");p.className="ntc-p "+(done?"done":"unc");
      var l=document.createElement("div");
      var st;
      if(rd[nm])st='<span class="ok">✓ confirmed '+escH(nzTime(rd[nm]))+'</span>';
      else if(done&&!marked.length)st='<span class="ok">run started · not confirmed</span>';
      else if(done){var allOk=marked.every(function(it){return mk[markKey(it)].s==="ok";});var last=marked.map(function(it){return mk[markKey(it)].at||"";}).sort().pop();st='<span class="ok">'+(allOk?"✓ confirmed by you":"dismissed")+(last?" "+escH(nzTime(last)):"")+'</span>';}
      else st='<span class="wait">not confirmed</span>';
      l.innerHTML="<b>"+escH(nm)+"</b><br>"+st;
      if(!done)waiting[nm]=1;
      if(!rd[nm]&&n.id){
        var acts=document.createElement("div");acts.className="acts";
        var mkBtn=function(label,cls,title,fn){var b=document.createElement("button");b.type="button";b.className="btn sm"+(cls?" "+cls:"");b.textContent=label;b.title=title;b.addEventListener("click",function(ev){ev.stopPropagation();fn();});acts.appendChild(b);};
        if(open.length){
          mkBtn("✓ Confirm","ok","Driver has seen these changes (told you in person, by text…)",function(){setMarks(open.map(function(it){return {nid:n.id,it:it};}),"ok");});
          mkBtn("Dismiss","","Take the red off without a confirmation",function(){setMarks(open.map(function(it){return {nid:n.id,it:it};}),"dismissed");});
        }
        if(marked.length)mkBtn("Undo","","Put the red back",function(){setMarks(marked.map(function(it){return {nid:n.id,it:it};}),null);});
        l.appendChild(acts);
      }
      var ul=document.createElement("ul");its.forEach(function(it){
        var li=document.createElement("li");li.textContent=it.text;var m=!rd[nm]&&mk[markKey(it)];
        if(m){li.className="marked";var s=document.createElement("span");s.className="mk";s.textContent=m.s==="ok"?"✓ confirmed":"dismissed";li.appendChild(s);}
        else if(!rd[nm]&&itemPast(it)){li.className="marked";var s2=document.createElement("span");s2.className="mk";s2.textContent="run started · not confirmed";li.appendChild(s2);}
        ul.appendChild(li);});
      p.appendChild(l);p.appendChild(ul);c.appendChild(p);
    });
    inn.appendChild(c);
  });
  if(NHIST)inn.appendChild(noticeHistEl());
  var hb=document.getElementById("noticeHist");if(hb)hb.textContent=NHIST?"Hide history":"History";
  var w=Object.keys(waiting);
  box.classList.toggle("hot",!!w.length);
  document.getElementById("noticeSum").textContent=w.length?"waiting on "+w.join(", ")+" · red cells on the board are changes not confirmed yet":"everyone has confirmed this week's changes";
}
/* re-check every 5 minutes so changes go historic as their shift finishes, without a reload */
setInterval(function(){try{if(drag||!menuEl.hidden||STAFF)return;if(JSON.stringify(uncKeys())!==JSON.stringify(UNC))render();else renderNotices();}catch(e){}},300000);
/* HISTORY (29 Oct 2026): every roster change sent (all weeks, newest first) and what happened to it, per driver */
var NHIST=false;
function ntcStatusRB(n,nm){
  var rd=(n.reads||{})[nm],mk=n.marks||{},its=(n.items||[]).filter(function(it){return it.name===nm;});
  if(rd)return {c:"ok",l:"✓ confirmed by driver "+nzTime(rd)};
  var mks=its.map(function(it){return mk[markKey(it)];});
  if(its.length&&mks.every(Boolean)){var allOk=mks.every(function(m){return m.s==="ok";});var last=mks.map(function(m){return m.at||"";}).sort().pop();return {c:allOk?"ok":"dis",l:(allOk?"✓ confirmed by you":"dismissed")+(last?" "+nzTime(last):"")};}
  if(its.length&&its.every(function(it){return mk[markKey(it)]||itemPast(it);}))return {c:"past",l:"run started · not confirmed"};
  return {c:"wait",l:"waiting"};
}
function noticeHistEl(){
  var box=document.createElement("div");box.id="noticeHistIn";
  var L=(NOTICES||[]).filter(function(n){return n&&n.at;}).slice().sort(function(a,b){return a.at<b.at?1:a.at>b.at?-1:0;});
  var cnt={ok:0,dis:0,past:0,wait:0};
  var h=document.createElement("h3");box.appendChild(h);
  L.forEach(function(n){
    var c=document.createElement("div");c.className="ntc";
    var hd=document.createElement("div");hd.className="ntc-h";hd.textContent="Sent "+nzTime(n.at)+(n.week?" · week of "+fmtD(n.week):"");c.appendChild(hd);
    (n.names||[]).forEach(function(nm){
      var its=(n.items||[]).filter(function(it){return it.name===nm;});if(!its.length)return;
      var st=ntcStatusRB(n,nm);cnt[st.c]++;
      var p=document.createElement("div");p.className="ntc-p done";
      var l=document.createElement("div");l.innerHTML="<b>"+escH(nm)+'</b><br><span class="nhs '+st.c+'">'+escH(st.l)+"</span>";
      var ul=document.createElement("ul");its.forEach(function(it){var li=document.createElement("li");li.textContent=it.text;ul.appendChild(li);});
      p.appendChild(l);p.appendChild(ul);c.appendChild(p);
    });
    box.appendChild(c);
  });
  h.textContent="History · "+L.length+" change notice"+(L.length===1?"":"s")+" · "+cnt.ok+" confirmed · "+cnt.dis+" dismissed · "+cnt.past+" run started, not confirmed · "+cnt.wait+" waiting";
  if(!L.length){var e=document.createElement("p");e.className="lempty";e.textContent="No roster changes sent yet.";box.appendChild(e);}
  return box;
}
document.getElementById("noticeHist").addEventListener("click",function(ev){ev.stopPropagation();NHIST=!NHIST;document.getElementById("noticeBox").classList.remove("closed");renderNotices();});
onTap(document.getElementById("noticeHead"),function(ev){
  if(ev&&ev.target&&(ev.target.id==="noticeSync"||ev.target.id==="noticeHist"))return;
  document.getElementById("noticeBox").classList.toggle("closed");
});
document.getElementById("noticeSync").addEventListener("click",function(ev){
  ev.stopPropagation();var b=ev.currentTarget;b.disabled=true;b.textContent="Checking…";
  fireSync().then(function(){b.textContent="Started — updates in a minute or two";},function(){b.textContent="Couldn't start";})
    .then(function(){setTimeout(function(){b.disabled=false;b.textContent="Check now";},60000);});
});

/* ---------- leave requests ---------- */
var LTYPES=[["annual","Annual leave"],["sick","Sick leave"],["unpaid","Unpaid leave"],["bereave","Bereavement leave"],["dayoff","Day off request"],["other","Other"]];
function ltLabel(t){for(var i=0;i<LTYPES.length;i++)if(LTYPES[i][0]===t)return LTYPES[i][1];return "Leave";}
var EMAILS={},MCP=null,LDB=null,myRef=null,myDoc=null,lPart="full",lBusy=false,isEd=false;
function dOf(s){return new Date(s+"T00:00:00");}
function fmtD(s){var d=dOf(s);return DAYS[(d.getDay()+6)%7]+" "+d.getDate()+" "+MON[d.getMonth()];}
function spanTxt(r){var t=r.from===r.to?fmtD(r.from):fmtD(r.from)+" – "+fmtD(r.to);if(r.part&&r.part!=="full")t+=r.part==="AM"?" · morning off":" · afternoon off";return t;}
function nDays(r){if(r.part&&r.part!=="full")return 0.5;return Math.round((dOf(r.to)-dOf(r.from))/864e5)+1;}
function daysTxt(r){var n=nDays(r);return n===0.5?"half day":n+" day"+(n===1?"":"s");}
function todayKey(){return key(new Date());}
function drvName(id,fallback){return DNAME[id]||fallback||id||"Someone";}
function mkPill(st){var p=document.createElement("span");p.className="lpill "+st;p.textContent=st==="pending"?"waiting":st;return p;}
function lErr(e){var c=e&&e.code;if(c==="permission_denied"||c==="not_granted"||c==="forbidden")return "You don't have access to send requests yet. Ask Jeremy to add you to the board as a Contributor.";return "That didn't send: "+(e&&(e.message||c)||"try again")+".";}

/* staff form */
(function(){
  var sel=document.getElementById("lType");
  LTYPES.forEach(function(t){var o=document.createElement("option");o.value=t[0];o.textContent=t[1];sel.appendChild(o);});
  var f=document.getElementById("lFrom"),t=document.getElementById("lTo");
  f.value=key(addDays(new Date(),1));t.value=f.value;
  try{var r=localStorage.getItem("taieri-leave-drv");if(r)document.getElementById("lDrv").dataset.want=r;var em0=localStorage.getItem("taieri-leave-email");if(em0)document.getElementById("lEmail").value=em0;}catch(e){}
  function sync(){
    if(t.value<f.value)t.value=f.value;
    var one=f.value&&f.value===t.value;
    document.querySelectorAll("#lPart button").forEach(function(b){if(b.dataset.p!=="full")b.disabled=!one;});
    if(!one)lPart="full";
    document.querySelectorAll("#lPart button").forEach(function(b){b.classList.toggle("on",b.dataset.p===lPart);});
    var sum=document.getElementById("lSum");
    sum.textContent=(f.value&&t.value)?spanTxt({from:f.value,to:t.value,part:lPart})+" · "+daysTxt({from:f.value,to:t.value,part:lPart}):"";
  }
  f.addEventListener("change",sync);t.addEventListener("change",sync);
  document.getElementById("lPart").addEventListener("click",function(ev){var b=ev.target.closest("button");if(!b||b.disabled)return;lPart=b.dataset.p;sync();});
  sync();
  document.getElementById("lForm").addEventListener("submit",function(ev){
    ev.preventDefault();if(lBusy)return;
    var msg=document.getElementById("lMsg");msg.className="lmsg";
    var drv=document.getElementById("lDrv").value;
    if(!drv){msg.className="lmsg bad";msg.textContent="Choose your name first.";return;}
    var em=document.getElementById("lEmail").value.trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){msg.className="lmsg bad";msg.textContent="Enter your email address so we can confirm your request.";return;}
    if(!f.value||!t.value){msg.className="lmsg bad";msg.textContent="Pick the first and last day you need off.";return;}
    if(!myRef){msg.className="lmsg bad";msg.textContent="Sign in to claude.ai with the email Jeremy invited, then open this link again.";return;}
    try{localStorage.setItem("taieri-leave-drv",drv);localStorage.setItem("taieri-leave-email",em);}catch(e){}
    var req={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),driver:drv,type:sel.value,from:f.value,to:t.value,part:lPart,notes:document.getElementById("lNote").value.trim().slice(0,600),email:em.slice(0,200),status:"pending",created:new Date().toISOString()};
    lBusy=true;document.getElementById("lGo").disabled=true;msg.textContent="Sending…";
    myRef.get().then(function(snap){
      var v=snap.exists?clone(snap.data()):{};
      var rs=(v.requests||[]).concat([req]);
      return myRef.set({driver:drv,requests:rs});
    }).then(function(){
      msg.className="lmsg ok";msg.textContent="Sent. Within about an hour you'll get an email confirming we've received it. Nothing is approved yet. You'll get another email once Jeremy has approved or declined it.";
      document.getElementById("lNote").value="";
    }).catch(function(e){msg.className="lmsg bad";msg.textContent=lErr(e);})
    .then(function(){lBusy=false;document.getElementById("lGo").disabled=false;});
  });
})();
function fillDrivers(){
  var s=document.getElementById("lDrv");if(!s)return;
  var cur=s.value||s.dataset.want||"";
  var list=(state.cfg.drivers||[]).filter(function(d){return d.name&&d.id!=="dmuf17o3o"&&!/^other$/i.test(d.name);}).slice().sort(function(a,b){return a.name.localeCompare(b.name);});
  var sig=list.map(function(d){return d.id+d.name;}).join("|");
  if(s.dataset.sig===sig)return;
  s.dataset.sig=sig;s.innerHTML='<option value="">Choose your name…</option>';
  list.forEach(function(d){var o=document.createElement("option");o.value=d.id;o.textContent=d.name;s.appendChild(o);});
  if(cur&&list.some(function(d){return d.id===cur;}))s.value=cur;
}
function renderMine(){
  var box=document.getElementById("lMine");if(!box)return;
  var rs=((myDoc&&myDoc.requests)||[]).slice().sort(function(a,b){return (b.created||"").localeCompare(a.created||"");});
  if(!rs.length){box.innerHTML='<p class="lempty">Nothing yet. Requests you send show here with Jeremy\'s answer.</p>';return;}
  box.innerHTML="";
  rs.forEach(function(r){
    var it=document.createElement("div");it.className="litem";
    var w=document.createElement("div");w.className="lw";w.textContent=ltLabel(r.type)+" · "+drvName(r.driver);
    it.appendChild(w);it.appendChild(mkPill(r.status));
    var d=document.createElement("div");d.className="ld";d.textContent=spanTxt(r)+" · "+daysTxt(r);d.style.gridColumn="1/-1";it.appendChild(d);
    if(r.notes){var n=document.createElement("div");n.className="ln";n.textContent=r.notes;it.appendChild(n);}
    if(r.reply){var rp=document.createElement("div");rp.className="lr";rp.textContent="Jeremy: "+r.reply;it.appendChild(rp);}
    if(r.status==="pending"){
      var a=document.createElement("div");a.className="lact";
      var c=document.createElement("button");c.type="button";c.textContent="Cancel this request";
      c.addEventListener("click",function(){
        if(c.dataset.arm!=="1"){c.dataset.arm="1";c.textContent="Tap again to cancel";return;}
        c.disabled=true;
        myRef.get().then(function(snap){var v=clone(snap.data()||{});(v.requests||[]).forEach(function(x){if(x.id===r.id)x.status="cancelled";});return myRef.set(v);})
          .catch(function(e){c.disabled=false;c.textContent=lErr(e);});
      });
      a.appendChild(c);it.appendChild(a);
    }
    box.appendChild(it);
  });
}
/* owner panel */
function longD(s){var d=dOf(s);return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()]+" "+d.getDate()+" "+["January","February","March","April","May","June","July","August","September","October","November","December"][d.getMonth()]+" "+d.getFullYear();}
function escH(t){return String(t).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c];});}
var MAILNOTE={};   /* request id -> email status line shown under the request */
function mailApproval(uid,r){
  var to=r.email||EMAILS[r.driver];
  if(!to){MAILNOTE[r.id]="No email on file for "+drvName(r.driver)+" — tell them yourself.";renderLeaveAll();return;}
  if(!MCP){MAILNOTE[r.id]=(r.status==="declined"?"Declined":"Approved")+". The email couldn't be sent from here (Outlook not connected to this page).";renderLeaveAll();return;}
  var first=drvName(r.driver).split(" ")[0];
  var when=r.from===r.to?longD(r.from):longD(r.from)+" to "+longD(r.to);
  if(r.part&&r.part!=="full")when+=r.part==="AM"?" (morning off)":" (afternoon off)";
  var ok=r.status!=="declined";
  var body=ok
    ?"<p>Hi "+escH(first)+",</p><p>Your "+escH(ltLabel(r.type).toLowerCase())+" for <b>"+escH(when)+"</b> ("+daysTxt(r)+") is approved. It's on the roster.</p>"+(r.reply?"<p>"+escH(r.reply)+"</p>":"")+"<p>Thanks,<br>Jeremy<br>Taieri Post Limited</p>"
    :"<p>Hi "+escH(first)+",</p><p>Thanks for your request for "+escH(ltLabel(r.type).toLowerCase())+" on <b>"+escH(when)+"</b>. I'm not able to approve it as it stands.</p>"+(r.reply?"<p>"+escH(r.reply)+"</p>":"")+"<p>Could you please set up a time to meet with me so we can talk it through and look at other options? Reply to this email or give me a call with a time that suits you.</p><p>Thanks,<br>Jeremy<br>Taieri Post Limited</p>";
  MAILNOTE[r.id]="Sending email to "+to+"…";renderLeaveAll();
  MCP.callTool("Microsoft 365","outlook_send_mail",{to:[to],subject:(ok?"Leave approved – ":"Your leave request – ")+(r.from===r.to?fmtD(r.from):fmtD(r.from)+" to "+fmtD(r.to)),body:body,bodyType:"html"})
    .then(function(){
      MAILNOTE[r.id]="Email sent to "+to+".";
      var ref=LDB.doc("leave/"+uid);
      return ref.get().then(function(snap){var v=clone(snap.data()||{});(v.requests||[]).forEach(function(x){if(x.id===r.id)x.emailed=new Date().toISOString();});return ref.set(v);});
    })
    .catch(function(e){MAILNOTE[r.id]=(ok?"Approved":"Declined")+", but the email didn't send: "+(e&&(e.message||e.code)||"error")+". Tell "+first+" yourself.";})
    .then(renderLeaveAll);
}
/* automatic "request received" email: sent from Jeremy's Outlook the first time the board sees a new request */
var ACKING={};
function mailAck(uid,r){
  var to=r.email||EMAILS[r.driver];
  if(!to||!MCP||ACKING[r.id])return;ACKING[r.id]=1;
  var first=drvName(r.driver).split(" ")[0];
  var when=r.from===r.to?longD(r.from):longD(r.from)+" to "+longD(r.to);
  if(r.part&&r.part!=="full")when+=r.part==="AM"?" (morning off)":" (afternoon off)";
  var body="<p>Hi "+escH(first)+",</p><p>We've received your leave request. Here are the details:</p><ul><li><b>Type:</b> "+escH(ltLabel(r.type))+"</li><li><b>Dates:</b> "+escH(when)+" ("+daysTxt(r)+")</li>"+(r.notes?"<li><b>Your note:</b> "+escH(r.notes)+"</li>":"")+"</ul><p><b>Please note: this request is not approved yet.</b> Jeremy will review it, and you'll get a separate email saying whether it's approved or declined. Please don't make any bookings until you have the approval email.</p><p>Thanks,<br>Jeremy<br>Taieri Post Limited</p>";
  MCP.callTool("Microsoft 365","outlook_send_mail",{to:[to],subject:"Leave request received – "+(r.from===r.to?fmtD(r.from):fmtD(r.from)+" to "+fmtD(r.to))+" (not yet approved)",body:body,bodyType:"html"})
    .then(function(){
      MAILNOTE[r.id]="Received email sent to "+to+".";
      var ref=LDB.doc("leave/"+uid);
      return ref.get().then(function(snap){var v=clone(snap.data()||{});(v.requests||[]).forEach(function(x){if(x.id===r.id)x.acked=new Date().toISOString();});return ref.set(v);});
    })
    .catch(function(e){delete ACKING[r.id];MAILNOTE[r.id]="The received email didn't send: "+(e&&(e.message||e.code)||"error")+".";})
    .then(renderLeaveAll);
}
function ackNew(){
  if(!MCP||!LDB)return;
  LEAVE.forEach(function(d){(d.requests||[]).forEach(function(r){if(r.status==="pending"&&!r.acked)mailAck(d.uid,r);});});
}
function decide(uid,rid,status,reply,btn){
  if(!LDB)return;btn&&(btn.disabled=true);
  var ref=LDB.doc("leave/"+uid),done=null;
  ref.get().then(function(snap){
    var v=clone(snap.data()||{});
    (v.requests||[]).forEach(function(x){if(x.id===rid){x.status=status;if(reply!==undefined)x.reply=reply;x.decided=new Date().toISOString();done=x;}});
    return ref.set(v);
  }).then(function(){if((status==="approved"||status==="declined")&&done)mailApproval(uid,done);})
  .catch(function(e){if(btn){btn.disabled=false;btn.textContent="Didn't save — retry";}setStatus("leave NOT saved — "+(e&&(e.message||e.code)||"write failed"));});
}
function renderLeaveAll(){
  fillDrivers();
  if(STAFF||document.documentElement.classList.contains("staffmode"))renderMine();
  var box=document.getElementById("leaveBoxIn");if(!box||!isEd)return;
  var all=[];LEAVE.forEach(function(d){(d.requests||[]).forEach(function(r){all.push({uid:d.uid,r:r});});});
  var today=todayKey();
  var pend=all.filter(function(x){return x.r.status==="pending";}).sort(function(a,b){return a.r.from.localeCompare(b.r.from);});
  var appr=all.filter(function(x){return x.r.status==="approved"&&x.r.to>=today;}).sort(function(a,b){return a.r.from.localeCompare(b.r.from);});
  var cut=new Date(Date.now()-14*864e5).toISOString();
  var decl=all.filter(function(x){return x.r.status==="declined"&&(x.r.decided||"")>=cut;}).sort(function(a,b){return (b.r.decided||"").localeCompare(a.r.decided||"");});
  var wkS=key(state.mon),wkE=key(addDays(state.mon,6));
  var thisWk=appr.filter(function(x){return x.r.from<=wkE&&x.r.to>=wkS;}).length;
  document.getElementById("leaveBox").classList.toggle("quiet",!pend.length);
  document.getElementById("leaveCount").textContent=(pend.length?pend.length+" waiting for you · ":"")+(appr.length?appr.length+" approved coming up":"no approved leave coming up")+(thisWk?" · "+thisWk+" in the week on screen":"");
  box.innerHTML="";
  function item(x,mode){
    var r=x.r,it=document.createElement("div");it.className="litem";
    var w=document.createElement("div");w.className="lw";w.textContent=drvName(r.driver)+" · "+ltLabel(r.type);
    it.appendChild(w);it.appendChild(mkPill(r.status));
    var d=document.createElement("div");d.className="ld";d.style.gridColumn="1/-1";d.textContent=spanTxt(r)+" · "+daysTxt(r)+(r.created?" · asked "+fmtD(r.created.slice(0,10)):"")+(r.email?" · "+r.email:"");it.appendChild(d);
    if(r.notes){var n=document.createElement("div");n.className="ln";n.textContent=r.notes;it.appendChild(n);}
    if(r.reply&&mode!=="pending"){var rp=document.createElement("div");rp.className="lr";rp.textContent="Your reply: "+r.reply;it.appendChild(rp);}
    var mn=MAILNOTE[r.id]||(mode!=="pending"?(r.emailed?"Email sent "+fmtD(r.emailed.slice(0,10))+".":((r.email||EMAILS[r.driver])?"":"No email on file.")):(r.acked?"Received email sent "+fmtD(r.acked.slice(0,10))+".":""));
    if(mn){var me=document.createElement("div");me.className="ln";me.style.fontFamily="var(--fm)";me.style.fontSize="11.5px";me.textContent=mn;it.appendChild(me);}
    var a=document.createElement("div");a.className="lact";
    if(mode==="pending"){
      var inp=document.createElement("input");inp.type="text";inp.placeholder="Reply (optional)";inp.id="lrep-"+r.id;inp.setAttribute("aria-label","Reply to "+drvName(r.driver));
      var y=document.createElement("button");y.type="button";y.className="yes";y.textContent="Approve & send email";
      var no=document.createElement("button");no.type="button";no.className="no";no.textContent="Decline & send email";
      y.addEventListener("click",function(){decide(x.uid,r.id,"approved",inp.value.trim(),y);});
      no.addEventListener("click",function(){decide(x.uid,r.id,"declined",inp.value.trim(),no);});
      a.appendChild(inp);a.appendChild(y);a.appendChild(no);
    }else{
      var g=document.createElement("button");g.type="button";g.textContent="Go to that week";
      g.addEventListener("click",function(){state.mon=monday(dOf(r.from));openWeek();});
      var u=document.createElement("button");u.type="button";u.textContent=mode==="declined"?"Move back to waiting":"Undo approval";
      u.addEventListener("click",function(){if(u.dataset.arm!=="1"){u.dataset.arm="1";u.textContent="Tap again to undo";return;}decide(x.uid,r.id,"pending",undefined,u);});
      a.appendChild(g);a.appendChild(u);
    }
    it.appendChild(a);return it;
  }
  if(!pend.length&&!appr.length&&!decl.length){box.innerHTML='<p class="lempty">No leave waiting or coming up. Staff send requests from the leave page (this board\'s link with #leave on the end).</p>';return;}
  if(pend.length){var k=document.createElement("span");k.className="lk";k.textContent="Waiting for you";box.appendChild(k);pend.forEach(function(x){box.appendChild(item(x,"pending"));});}
  if(appr.length){var k2=document.createElement("span");k2.className="lk";k2.textContent="Approved · coming up";box.appendChild(k2);appr.forEach(function(x){box.appendChild(item(x,"approved"));});}
  if(decl.length){var k3=document.createElement("span");k3.className="lk";k3.textContent="Declined · last 2 weeks";box.appendChild(k3);decl.forEach(function(x){box.appendChild(item(x,"declined"));});}
}
onTap(document.getElementById("leaveHead"),function(){
  var b=document.getElementById("leaveBox");b.classList.toggle("closed");
  try{localStorage.setItem("taieri-leave-open",b.classList.contains("closed")?"0":"1");}catch(e){}
});
try{if(localStorage.getItem("taieri-leave-open")==="0")document.getElementById("leaveBox").classList.add("closed");}catch(e){}
(function(){
  if(!window.claude||!window.claude.use)return;
  var want=document.documentElement.classList.contains("staffmode");
  Promise.all([window.claude.use("db"),window.claude.use("user")]).then(function(res){
    var db=res[0],u=res[1];
    var p1=u?u.isOwner():Promise.resolve(false),p2=u?u.canEdit():Promise.resolve(false);
    return Promise.all([p1,p2]).then(function(e){
      isEd=!!(e[0]||e[1]);
      if(isEd&&want){var lb=document.getElementById("lBack");lb.hidden=false;lb.addEventListener("click",function(){try{history.replaceState(null,"",location.pathname+location.search);}catch(_){location.hash="";}document.documentElement.classList.remove("staffmode");want=false;render();});}
      if(!isEd){STAFF=true;document.documentElement.classList.add("staffmode");}
      if(!db){var m=document.getElementById("lMsg");m.className="lmsg bad";m.textContent="Sign in to claude.ai with the email Jeremy invited, then open this link again.";return;}
      LDB=db;
      if(STAFF||want){
        if(!u){return;}
        u.id().then(function(id){
          if(!id)return;
          myRef=db.doc("leave/"+id);
          myRef.onSnapshot(function(snap){myDoc=snap.exists?snap.data():null;renderMine();},function(){});
        });
      }
      if(isEd){
        db.doc("leaveadmin/emails").onSnapshot(function(snap){EMAILS=(snap.exists&&snap.data().map)||{};renderLeaveAll();},function(){});
        window.claude.use("mcp").then(function(m){MCP=m;ackNew();}).catch(function(){});
        watchNotices();
        db.collection("leave").onSnapshot(function(qs){
          LEAVE=qs.docs.map(function(d){var v=d.data()||{};return {uid:d.id,driver:v.driver,requests:v.requests||[]};});
          render();ackNew();
        },function(){});
      }
      renderLeaveAll();
    });
  }).catch(function(){});
})();

/* ---------- cover plan: who replaces who ---------- */
var CV_SHUFFLE={FLY:1,TUA:1,RAM:1};          /* runs whose time can move to fit a cover driver */
var CV_NEVER={"J":1,"dmudmfw51":1,"CH":1,"dmudma1p1":1,"C":1};    /* Jeremy, Pat, Jack, Peter (rostered days only) and Cole (leaving) never cover */
var CV_JAMES_S="JA";
var cvDay=null,cvReady=true;
function cvBusy(day){
  /* every person's busy intervals that day, from runs, trainees and sorts */
  var b={},add=function(id,s,e,run){if(!id||s==null||e==null)return;(b[id]=b[id]||[]).push([s,e,run]);};
  var runs=slots(day);
  runs.forEach(function(run){
    if(W[run].novan)return;var sp=espan(run,day);if(!sp)return;var a=get(day,run);
    ["drv","drv2","drv3","drv4","tr"].forEach(function(f){add(a[f],sp[0],sp[1],run);});
  });
  runs.forEach(function(run){
    if(!W[run].novan||run==="BU")return;var w=win(run,day);if(!w)return;var a=get(day,run);
    [["drv","st"],["drv2","st2"],["drv3","st3"],["drv4","st4"]].forEach(function(p){
      var id=a[p[0]];if(!id)return;
      var s=a[p[1]]?Math.round(a[p[1]]*60):w[0][0];
      var nxt=(b[id]||[]).filter(function(x){return x[0]>s&&x[0]<=s+180;}).map(function(x){return x[0];});
      var e=nxt.length?Math.min.apply(null,nxt):Math.min(s+90,w[w.length-1][1]);
      (b[id]=b[id]||[]).push([s,e,run,true]);   /* sort: doesn't stop them going straight on to a run after it */
    });
  });
  return b;
}
function cvFree(iv,s,e){for(var i=0;i<iv.length;i++){if(iv[i][3]&&s>=iv[i][0])continue;if(iv[i][0]<e&&s<iv[i][1])return false;}return true;}
function cvSkill(id,run){var s=skillOf(id,run);return s==="yes"?2:(s==="tr"?1:0);}
function cvCover(day,run,busy,hrs){
  var sp=espan(run,day),len=sp[1]-sp[0],a=get(day,run);
  var onRun={};["drv","drv2","drv3","drv4","tr"].forEach(function(f){if(a[f])onRun[a[f]]=1;});
  var db=get(day,"DB"),dbSolo=!!(win("DB",day)&&db.drv&&!["FLY","TUA"].some(function(r){var x=get(day,r);return win(r,day)&&x.drv===db.drv;}));
  var out=[];
  (state.cfg.drivers||[]).forEach(function(d){
    var id=d.id;
    if(onRun[id]||CV_NEVER[id]||/^other$/i.test(d.name||""))return;
    if(id===CV_JAMES_S&&!dbSolo)return;
    var sk=cvSkill(id,run);if(!sk)return;
    var av=availOf(id,day);if(!av)return;
    var iv=busy[id]||[],at=null;
    if(sp[0]>=av[0]&&sp[1]<=av[1]&&cvFree(iv,sp[0],sp[1]))at=sp[0];
    else if(CV_SHUFFLE[run]){
      var lo=Math.max(av[0],sp[0]-240),hi=Math.min(av[1]-len,sp[0]+240);
      for(var t2=lo;t2<=hi;t2+=15){if(cvFree(iv,t2,t2+len)){at=t2;break;}}
    }
    if(at===null)return;
    var mins=iv.reduce(function(m,x){return m+(x[1]-x[0]);},0);
    var tier=mins===0?0:(mins<=270?1:2);
    out.push({id:id,sk:sk,at:at,moved:at!==sp[0],tier:tier,mins:mins,hrs:hrs[id]||0,js:id===CV_JAMES_S});
  });
  out.sort(function(x,y){return (y.sk-x.sk)||(x.tier-y.tier)||(x.moved-y.moved)||(x.hrs-y.hrs);});
  /* West Harbour cover:
     Tue/Thu (long shifts) - Amar or Liam steps in;
     Sat - the other driver does both, or Liam does RSB;
     other days - the other driver does both */
  if(run==="PCB"||run==="RSB"){
    var other=run==="PCB"?"RSB":"PCB",oa=get(day,other),osp=espan(other,day);
    var both=(oa.drv&&osp&&!onRun[oa.drv]&&cvSkill(oa.drv,run))?{id:oa.drv,sk:cvSkill(oa.drv,run),at:sp[0],moved:false,tier:2,hrs:hrs[oa.drv]||0,note:run==="PCB"?"does both, PCB first then RSB later":"does both, RSB after PCB"}:null;
    var step=function(id){
      if(onRun[id]||!availOf(id,day))return null;
      var av=availOf(id,day),len=sp[1]-sp[0],iv=busy[id]||[];
      for(var s2=Math.max(sp[0],av[0]);s2<=sp[0]+180&&s2+len<=av[1];s2+=15){
        if(cvFree(iv,s2,s2+len))return {id:id,sk:Math.max(1,cvSkill(id,run)),at:s2,moved:s2!==sp[0],tier:1,hrs:hrs[id]||0};
      }
      return null;
    };
    if(day==="Tue"||day==="Thu"){
      out=["A","LT"].map(step).filter(Boolean);
    }else if(day==="Sat"){
      out=[];if(both)out.push(both);
      if(run==="RSB"){var l=step("LT");if(l)out.push(l);}
    }else if(both&&out.length<2&&!out.some(function(c){return c.id===both.id;}))out.push(both);
  }
  /* TGE: James M into the run (Liam takes his RSB); if Town is out, Grace moves to Town and the fill-in does Suburbs */
  if((run==="S"||run==="T")&&!out.length){
    var JM="dmudmnk49",LT="LT",rsb=get(day,"RSB");
    var jmOnTge=["S","T"].some(function(r){return get(day,r).drv===JM;});
    var jmOther=(busy[JM]||[]).filter(function(x){return x[2]!=="RSB"&&x[2]!=="SUP3";});
    if(!onRun[JM]&&!jmOnTge&&availOf(JM,day)&&cvFree(jmOther,sp[0],sp[1])){
      var rsp=espan("RSB",day),swap="";
      if(rsb.drv===JM&&rsp){
        var ltFree=availOf(LT,day)&&cvFree(busy[LT]||[],rsp[0],rsp[1]);
        var pcb=get(day,"PCB");
        swap=ltFree?", Liam takes his RSB"+(cvSkill(LT,"RSB")===2?"":" (with support)"):(pcb.drv&&pcb.drv!==JM?", "+drvName(pcb.drv)+" does both PCB and RSB":", RSB needs cover");
      }
      if(run==="T"&&get(day,"S").drv==="G")out.push({id:"G",sk:2,at:sp[0],moved:false,tier:2,hrs:0,note:"moves to Town; James M does Suburbs"+swap});
      else out.push({id:JM,sk:Math.max(1,cvSkill(JM,run)),at:sp[0],moved:false,tier:2,hrs:0,note:"into the run"+swap});
    }
  }
  /* James S is never a back-up (26 Oct) */
  out=out.filter(function(c){return c.id!==CV_JAMES_S;});
  return out.slice(0,2);
}
var CV_NAME={S:"Suburbs",T:"Town",FLY:"Flyer",DB:"D>B",LAW:"Lawrence",FB:"Food bag AM",FBP:"Food bag PM"};
function cvR(run){return CV_NAME[run]||RL(run);}
function hm(v){var h=Math.floor(v/60),x=v%60;return h+":"+(x<10?"0":"")+x;}
function cvTime(run,day,at){var sp=espan(run,day);return hm(at!=null?at:sp[0])+"–"+hm((at!=null?at:sp[0])+(sp[1]-sp[0]));}
function cvSwapTxt(n){if(/Liam takes/.test(n))return " · Liam does RSB instead of James M"+(/with support/.test(n)?" (with support)":"");var m=n.match(/, ([^,]+ does both PCB and RSB)/);if(m)return " · "+m[1];if(/RSB needs cover/.test(n))return " · RSB needs cover";return "";}
function cvChange(day,run,c,outName){
  var r=cvR(run),tm=cvTime(run,day,c?c.at:null);
  if(!c&&run==="DB")return "D>B "+tm+": Jeremy to arrange cover";
  if(!c)return r+" "+tm+": nobody free and trained yet";
  var who=drvName(c.id),sup=c.sk===1?" (with support)":"";
  if(c.note&&/moves to Town/.test(c.note))return "Grace moves from Suburbs to Town · James M does Suburbs"+cvSwapTxt(c.note);
  if(c.note&&/into the run/.test(c.note))return "James M does "+r+cvSwapTxt(c.note);
  if(c.note&&/does both/.test(c.note))return who+" does both PCB and RSB (adds "+r+" "+tm+")";
  if(c.note&&/from Milton/.test(c.note))return "James S picks up D>B at Milton at 10:30 (Owaka 12:00–12:30 pick-up and drop-off, then Balclutha), then goes to Lawrence";
  return who+" does "+r+" "+tm+sup+(c.moved?" (moved from "+hm(espan(run,day)[0])+")":"");
}
function cvScenarios(day,hrs){
  var people={},order=[];
  slots(day).forEach(function(run){
    if(W[run].novan||!espan(run,day))return;var a=get(day,run);
    [a.drv].concat(XD.map(function(f){return a[f];})).filter(Boolean).forEach(function(id){if(!people[id]){people[id]=[];order.push(id);}people[id].push(run);});
  });
  return order.map(function(id){
    var busy=cvBusy(day);delete busy[id];
    /* James S out: Jeremy does D>B and Lawrence only; Jeremy's other runs are reshaped */
    if(id===CV_JAMES_S&&people[id].indexOf("LAW")>=0){
      var jr=(people["J"]||[]).filter(function(r){return r!=="DB"&&r!=="LAW";});
      busy["J"]=(busy["J"]||[]).filter(function(x){return jr.indexOf(x[2])<0;});
      var ch2=[{run:"LAW",c:{id:"J"},txt:"Jeremy does D>B and Lawrence only"}];
      jr.forEach(function(run){
        var c=cvCover(day,run,busy,hrs)[0]||null;
        if(c){var sp=espan(run,day);(busy[c.id]=busy[c.id]||[]).push([c.at,c.at+(sp[1]-sp[0]),run]);}
        ch2.push({run:run,c:c,txt:cvChange(day,run,c)});
      });
      return {id:id,name:drvName(id),runs:people[id],changes:ch2,gap:ch2.some(function(x){return !x.c;})};
    }
    var ch=people[id].map(function(run){
      var c=cvCover(day,run,busy,hrs)[0]||null;
      if(c){var sp=espan(run,day);(busy[c.id]=busy[c.id]||[]).push([c.at,c.at+(sp[1]-sp[0]),run]);}
      return {run:run,c:c,txt:cvChange(day,run,c)};
    });
    return {id:id,name:drvName(id),runs:people[id],changes:ch,gap:ch.some(function(x){return !x.c;})};
  });
}
function renderCover(){
  if(!cvReady)return;
  var box=document.getElementById("cvGrid");if(!box||STAFF)return;
  var hrs=(analyse().drvHrs)||{},all={};
  DAYS.forEach(function(d){all[d]=cvScenarios(d,hrs);});
  var days=DAYS.filter(function(d){return all[d].length;});
  if(!cvDay||days.indexOf(cvDay)<0){var td=DAYS[(new Date().getDay()+6)%7];cvDay=(days.indexOf(td)>=0&&key(monday(new Date()))===key(state.mon))?td:(days[0]||"Mon");}
  var dbx=document.getElementById("cvDays");dbx.innerHTML="";
  days.forEach(function(d){var b=document.createElement("button");b.type="button";b.textContent=d;if(d===cvDay)b.className="on";b.addEventListener("click",function(){cvDay=d;renderCover();});dbx.appendChild(b);});
  box.innerHTML="<thead><tr><th>If this person is out</th><th>Their shift</th><th>What changes</th></tr></thead>";
  var tb=document.createElement("tbody");
  (all[cvDay]||[]).forEach(function(s){
    var tr=document.createElement("tr");
    var c0=document.createElement("td");c0.className="cvrun";c0.textContent=s.name;tr.appendChild(c0);
    var c1=document.createElement("td");c1.textContent=s.runs.map(function(r){return cvR(r)+" "+cvTime(r,cvDay);}).join(", ");tr.appendChild(c1);
    var c2=document.createElement("td");
    s.changes.forEach(function(x){var dv=document.createElement("div");dv.textContent=x.txt;if(!x.c)dv.className="cvnone";else if(x.c.sk===1)dv.className="cvsup";c2.appendChild(dv);});
    tr.appendChild(c2);tb.appendChild(tr);
  });
  box.appendChild(tb);
  var gaps=0,lines=["BACK-UP PLAN — what changes if someone is out","If your shift changes, you'll be contacted the night before, or by 6:00am on the day. Please keep your days free where you can, and book appointments for late afternoon.",""];
  days.forEach(function(d){
    lines.push(d.toUpperCase()+" "+short(addDays(state.mon,DAYS.indexOf(d))));
    all[d].forEach(function(s){if(s.gap)gaps++;lines.push("• If "+s.name+" is out: "+s.changes.map(function(x){return x.txt;}).join("; ")+".");});
    lines.push("");
  });
  document.getElementById("coverSum").textContent=gaps?gaps+" absence"+(gaps===1?"":"s")+" this week would leave a run with nobody free":"every absence this week has a plan";
  document.getElementById("cvText").value=lines.join("\n").trim();
}
document.getElementById("cvCopy").addEventListener("click",function(){
  var ta=document.getElementById("cvText"),msg=document.getElementById("cvMsg");
  var sel=function(){ta.focus();ta.select();msg.textContent="Selected — press Ctrl+C";};
  try{navigator.clipboard.writeText(ta.value).then(function(){msg.textContent="Copied";setTimeout(function(){msg.textContent="";},2000);},sel);}catch(e){sel();}
});
onTap(document.getElementById("coverHead"),function(){
  var b=document.getElementById("coverBox");b.classList.toggle("closed");
  try{localStorage.setItem("taieri-cover-open",b.classList.contains("closed")?"0":"1");}catch(e){}
});
try{if(localStorage.getItem("taieri-cover-open")==="1")document.getElementById("coverBox").classList.remove("closed");}catch(e){}
renderCover();
})();
