/* Visibility-bound video playback; still artwork works without JS or hover. */
(() => {
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 const fine=window.matchMedia('(hover: hover) and (pointer: fine)');
 const records=[];
 const observer=new IntersectionObserver(entries=>entries.forEach(({target,isIntersecting})=>{
   target.classList.toggle('is-inview',isIntersecting);
   const r=records.find(r=>r.el===target);if(r){r.visible=isIntersecting;sync(r);}
 }),{rootMargin:'80px',threshold:.05});
 function sync(r){
   const wants=r.visible&&!document.hidden&&!reduced.matches&&!r.stopped&&(r.video.dataset.play!=='hover'||!fine.matches||r.hover);
   if(wants){r.video.play().then(()=>{if(r.video.paused||reduced.matches)return;r.el.classList.add('is-playing');r.button.hidden=false;r.button.textContent='Pause';r.button.setAttribute('aria-label','Pause animation');}).catch(()=>{r.button.hidden=true;});}
   else {r.video.pause();r.el.classList.remove('is-playing');if(r.stopped){r.button.textContent='Play';r.button.setAttribute('aria-label','Play animation');}}
 }
 document.querySelectorAll('.premium-media,.architecture').forEach(el=>{
   const video=el.querySelector('video');
   if(video){const button=el.querySelector('.media-pause');const r={el,video,button,visible:false,hover:false,stopped:false};records.push(r);video.muted=true;
     const hoverTarget=el.closest('.project-anchor')||el;
     hoverTarget.addEventListener('pointerenter',()=>{r.hover=true;sync(r);});
     hoverTarget.addEventListener('pointerleave',()=>{r.hover=false;sync(r);});
     button.addEventListener('click',e=>{e.preventDefault();r.stopped=!r.stopped;sync(r);});
     video.addEventListener('error',()=>{video.hidden=true;button.hidden=true;});
   }
   observer.observe(el);
 });
 reduced.addEventListener('change',()=>records.forEach(sync));
 document.addEventListener('visibilitychange',()=>records.forEach(sync));
})();
