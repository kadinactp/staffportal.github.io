// Deploy as the dedicated mailbox owner, only to users in the Workspace domain.
// Set ALLOWED_VIEWERS and APPROVED_SENDERS in Project Settings > Script properties.
// Comma separated exact email addresses. Empty lists deny all access.
const MAILBOX = 'staff@kadinactp.com';
function configList_(name) {
  return (PropertiesService.getScriptProperties().getProperty(name)||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
}
function authorize_() {
  const email=(Session.getActiveUser().getEmail()||'').toLowerCase();
  if (!email || !configList_('ALLOWED_VIEWERS').includes(email)) throw new Error('Report access denied.');
  if ((Gmail.Users.getProfile('me').emailAddress||'').toLowerCase()!==MAILBOX) throw new Error('Incorrect mailbox.');
}
function doGet(e) {
  try { authorize_(); if(e && e.parameter && e.parameter.view === 'dashboard') return HtmlService.createHtmlOutputFromFile('Dashboard').setTitle('Recent reports').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); if(e && e.parameter && e.parameter.view === 'embedded') return HtmlService.createHtmlOutputFromFile('Reports').setTitle('Reports Centre').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); return HtmlService.createHtmlOutputFromFile('Reports').setTitle('Kadina CTP Reports Centre'); }
  catch(e){return HtmlService.createHtmlOutput('Report access denied. Sign in with an authorised staff account.');}
}
function parts_(p,out){
  if (!p) return;
  if ((p.filename||'').toLowerCase().endsWith('.pdf') && p.mimeType==='application/pdf') out.push(p);
  (p.parts||[]).forEach(x=>parts_(x,out));
}
function header_(m,n){return ((m.payload.headers||[]).find(h=>h.name.toLowerCase()===n.toLowerCase())||{}).value||'';}
function approved_(m){
  const from=header_(m,'From').trim().toLowerCase();
  const match=from.match(/<([^<>]+)>$/);
  return configList_('APPROVED_SENDERS').includes(match?match[1].trim():from);
}
function classify_(name,subject){
  const t=(name+' '+subject).toLowerCase();
  if (/housekeep/.test(t))return 'Housekeeping';
  if (/departure/.test(t))return 'Departures';
  if (/arrival/.test(t))return 'Arrivals';
  if (/occupancy/.test(t))return 'Occupancy';
  return 'Other';
}
function listReports(){
  authorize_();
  const senders=configList_('APPROVED_SENDERS');
  if (!senders.length)return [];
  const rows=[]; let pageToken;
  do {
    const opts={q:'has:attachment filename:pdf newer_than:90d',maxResults:50};
    if(pageToken)opts.pageToken=pageToken;
    const page=Gmail.Users.Messages.list('me',opts);
    for(const item of (page.messages||[])){
      const m=Gmail.Users.Messages.get('me',item.id,{format:'full'});
      if(!approved_(m))continue;
      const parts=[];parts_(m.payload,parts);
      parts.forEach((p,i)=>rows.push({id:item.id,index:i,name:p.filename,subject:header_(m,'Subject'),date:Number(m.internalDate),size:Number(p.body.size||0),category:classify_(p.filename,header_(m,'Subject'))}));
    }
    pageToken=page.nextPageToken;
  } while(pageToken && rows.length<200);
  return rows.sort((a,b)=>b.date-a.date).slice(0,200);
}
function getReport(id,index){
  authorize_();
  if(typeof id!=='string'||!/^[-a-zA-Z0-9]+$/.test(id)||!Number.isInteger(index)||index<0)throw new Error('Invalid report.');
  const m=Gmail.Users.Messages.get('me',id,{format:'full'});
  if(!approved_(m)||Number(m.internalDate)<Date.now()-90*86400000)throw new Error('Report unavailable.');
  const ps=[];parts_(m.payload,ps);const p=ps[index];
  if(!p)throw new Error('Report unavailable.');
  if(p.body.size>10*1024*1024)throw new Error('PDF exceeds 10 MB.');
  const a=p.body.attachmentId?Gmail.Users.Messages.Attachments.get('me',id,p.body.attachmentId):p.body;
  const bytes=typeof a.data==='string'?Utilities.base64DecodeWebSafe(a.data):Array.from(a.data||[]).map(x=>((Number(x)+128)&255)-128);
  if(bytes.length>10*1024*1024||bytes.slice(0,5).map(x=>String.fromCharCode(x&255)).join('')!=='%PDF-')throw new Error('Invalid or oversized PDF.');
  return {name:p.filename,base64:Utilities.base64Encode(bytes)};
}
function testConnection(){console.log(Gmail.Users.getProfile('me').emailAddress);}
function testAccess(){authorize_();console.log('Access granted. Reports: '+listReports().length);}
