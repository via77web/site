'use strict';
// Progressive enhancement: every core page remains server-rendered HTML.
const sceneButtons = [...document.querySelectorAll('[data-scene]')];
const frames = [...document.querySelectorAll('[data-frame]')];
function selectScene(index) { frames.forEach((el,i)=>el.hidden=i!==index);sceneButtons.forEach((el,i)=>el.setAttribute('aria-pressed',String(i===index)));const count=document.querySelector('.scene-count');if(count)count.textContent=`0${index+1} — 06`; }
sceneButtons.forEach(button=>button.addEventListener('click',()=>selectScene(Number(button.dataset.scene))));
// An allowlisted analytics boundary. No names, email addresses, URLs or free text.
const allowedEvents = new Set(['hero_cta','solution_view','case_study_view','case_study_cta','assessment_start','enquiry_success','brief_download','project_form_start','email_click','phone_click','insight_cta']);
window.VIA77Analytics = Object.freeze({track(name,properties={}){if(!allowedEvents.has(name))return;const detail={event:name,path:location.pathname};for(const key of ['step','mode','type'])if(['string','number'].includes(typeof properties[key]))detail[key]=properties[key];window.dispatchEvent(new CustomEvent('via77:analytics',{detail}));if(window.VIA77_ANALYTICS_CONSENT===true&&Array.isArray(window.dataLayer))window.dataLayer.push(detail);}});
document.querySelectorAll('[data-event]').forEach(el=>el.addEventListener('click',()=>window.VIA77Analytics.track(el.dataset.event)));
if(location.pathname.startsWith('/solutions/')&&location.pathname.split('/').filter(Boolean).length>1)window.VIA77Analytics.track('solution_view');
if(location.pathname.startsWith('/work/')&&location.pathname.split('/').filter(Boolean).length>1)window.VIA77Analytics.track('case_study_view');
document.querySelectorAll('a[href^="mailto:"]').forEach(a=>a.addEventListener('click',()=>window.VIA77Analytics.track('email_click')));
document.querySelectorAll('a[href^="tel:"]').forEach(a=>a.addEventListener('click',()=>window.VIA77Analytics.track('phone_click')));

// Scroll enhances the six explicit stage controls; never takes focus from the user.
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
let sceneManual=false;sceneButtons.forEach(button=>button.addEventListener('click',()=>{sceneManual=true;}));
const journey=document.querySelector('.journey');
let scrollPending=false;
function updateSceneFromScroll(){scrollPending=false;if(!journey||sceneManual||motionPreference.matches||innerWidth<851)return;const rect=journey.getBoundingClientRect();const progress=Math.max(0,Math.min(1,(innerHeight*.65-rect.top)/(rect.height*.85)));if(rect.bottom>100&&rect.top<innerHeight*.65)selectScene(Math.min(5,Math.floor(progress*6)));}
if(journey){addEventListener('scroll',()=>{if(!scrollPending){scrollPending=true;requestAnimationFrame(updateSceneFromScroll);}},{passive:true});journey.addEventListener('focusin',()=>sceneManual=true);journey.addEventListener('pointerdown',()=>sceneManual=true);}
if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(motionPreference.matches)return;if(entry.target.classList.contains('convergence'))entry.target.classList.toggle('converged',entry.isIntersecting);else entry.target.classList.toggle('is-current',entry.isIntersecting);}),{rootMargin:'-15% 0px -25% 0px',threshold:.4});document.querySelectorAll('.convergence,.framework li').forEach(el=>observer.observe(el));}

// Progressive six-step form. Answers remain in memory; contact data is not persisted.
document.querySelectorAll('.project-form').forEach(form=>{
 let step=0,started=false,blobUrl=null,delivery=false,widget=null,token='',requestId=crypto.randomUUID(),busy=false;
 const fields=[...form.querySelectorAll('[data-step]')],back=form.querySelector('.form-back'),next=form.querySelector('.form-next'),submit=form.querySelector('.form-submit'),error=form.querySelector('.form-error'),result=form.querySelector('.form-result'),type=form.dataset.form;
 function data(){const fd=new FormData(form);return {type,project:fd.get('project')||'',platform:fd.get('platform')||'',challenges:fd.getAll('challenges'),investment:fd.get('investment')||'',timeline:fd.get('timeline')||'',name:(fd.get('name')||'').trim(),company:(fd.get('company')||'').trim(),website:(fd.get('website')||'').trim(),email:(fd.get('email')||'').trim(),phone:(fd.get('phone')||'').trim(),message:(fd.get('message')||'').trim(),consent:fd.get('consent')==='on',company_fax:fd.get('company_fax')||''};}
 function show(focus=true){fields.forEach((field,i)=>field.hidden=i!==step);form.querySelector('.step-current').textContent=String(step+1);form.querySelector('progress').value=step+1;back.hidden=step===0;next.hidden=step===5;submit.hidden=step!==5;error.textContent='';form.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));clearErrors();if(focus)fields[step].querySelector('legend').focus();}
 function errorsFor(current){return window.VIA77Validation.validate(data(),current);}
 function clearErrors(){form.querySelectorAll('.field-error').forEach(el=>el.remove());form.querySelectorAll('[aria-invalid]').forEach(el=>{el.removeAttribute('aria-invalid');el.removeAttribute('aria-describedby');});error.textContent='';}
 function displayErrors(errors){clearErrors();error.textContent=Object.values(errors).join(' ');for(const [name,message] of Object.entries(errors)){const controls=[...form.querySelectorAll(`[name="${name}"]`)];if(!controls.length)continue;const note=document.createElement('span');note.className='field-error';note.id=`${type}-${name}-error`;note.textContent=message;const last=controls[controls.length-1];(controls.length>1?last.closest('fieldset'):last.closest('label')).append(note);controls.forEach(el=>{el.setAttribute('aria-invalid','true');el.setAttribute('aria-describedby',note.id);});}error.focus();}
 async function configure(){try{const response=await fetch('/api/form-config',{cache:'no-store'});if(!response.ok)return;const config=await response.json();if(!config.enabled||!config.siteKey)return;delivery=true;submit.textContent='Send enquiry →';form.querySelector('.delivery-note').textContent='Your enquiry will be sent to VIA77. Security screening is provided by Cloudflare Turnstile; email delivery by Resend.';form.querySelector('.consent span').replaceChildren(document.createTextNode('I agree to send these details to VIA77 to respond to my enquiry. '));const privacy=document.createElement('a');privacy.href='/privacy/';privacy.textContent='Privacy information';form.querySelector('.consent span').append(privacy);const holder=document.createElement('div');holder.className='security-check';fields[5].append(holder);const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=()=>{widget=window.turnstile.render(holder,{sitekey:config.siteKey,action:'enquiry',size:'flexible',callback:value=>{token=value;},'expired-callback':()=>{token='';},'error-callback':()=>{token='';error.textContent='The security check could not load. Your answers remain here. Please try again.';}});};script.onerror=()=>{error.textContent='The security check could not load. Your answers remain here. Please reload when your connection is available.';};document.head.append(script);}catch{/* Download mode remains truthful when configuration is unavailable. */}}
 configure();
 function start(){if(!started){started=true;window.VIA77Analytics.track(type==='assessment'?'assessment_start':'project_form_start',{type});}}
 form.addEventListener('input',()=>{start();requestId=crypto.randomUUID();});form.addEventListener('change',()=>{start();requestId=crypto.randomUUID();result.hidden=true;});
 next.addEventListener('click',()=>{const errors=errorsFor(step);if(Object.keys(errors).length){displayErrors(errors);return;}step++;show();});
 back.addEventListener('click',()=>{step=Math.max(0,step-1);show();});
 form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;if(step<5){next.click();return;}const values=data(),errors=errorsFor();if(Object.keys(errors).length){const keys=['project','platform','challenges','investment','timeline'];const invalid=keys.findIndex(k=>errors[k]);if(invalid>=0){step=invalid;show();}displayErrors(errors);return;}
 clearErrors();
 if(delivery){
 if(!token){displayErrors({security:'Complete the security check before sending.'});return;}
 busy=true;submit.disabled=true;back.disabled=true;submit.textContent='Sending…';form.setAttribute('aria-busy','true');
 try{const response=await fetch('/api/project',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...values,turnstileToken:token,requestId}),signal:AbortSignal.timeout(25000)});const reply=await response.json();if(!response.ok||reply.ok!==true){displayErrors(reply.fields||{delivery:reply.error||'Sending failed. Your answers are still here; please retry.'});return;}result.textContent='Your enquiry has been accepted for delivery to VIA77. Thank you. Keep this page open if you need to refer to your answers.';result.hidden=false;result.focus();window.VIA77Analytics.track('enquiry_success',{type});submit.hidden=true;back.hidden=true;
 }catch{displayErrors({delivery:'We could not confirm delivery. Your answers are still here. Please retry; the same request will not be sent twice.'});}
 finally{busy=false;submit.disabled=false;back.disabled=false;submit.textContent='Retry enquiry →';form.removeAttribute('aria-busy');token='';if(widget!==null)window.turnstile.reset(widget);}
 return;
 }
 const lines=['VIA77 — '+(type==='assessment'?'Commerce Assessment':'Project brief'),'Prepared locally. Not submitted to VIA77.','',...Object.entries(values).filter(([k])=>!['consent','company_fax','type'].includes(k)).map(([key,value])=>`${key}: ${Array.isArray(value)?value.join(', '):value}`)];
 if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}));result.replaceChildren();const message=document.createElement('p');message.textContent='Your brief is ready to download. It has not been sent to VIA77.';const download=document.createElement('a');download.href=blobUrl;download.download=`via77-${type}-brief.txt`;download.textContent='Download your brief ↓';result.append(message,download);result.hidden=false;result.focus();download.addEventListener('click',()=>window.VIA77Analytics.track('brief_download',{type}));
 });
 // Enter in text fields behaves like the visible action; choice controls retain native keys.
 show(false);
 addEventListener('pagehide',()=>{if(blobUrl)URL.revokeObjectURL(blobUrl);});
});
