/* Shared by the browser, Node tests and the optional server delivery adapter. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.VIA77Validation=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const choices={project:['New ecommerce launch','Shopify redesign','Platform migration','Advanced/custom commerce','Commerce optimisation','Not sure yet'],platform:['Shopify','Shopify Plus','Magento','WooCommerce','Custom','Other','No current ecommerce platform'],challenges:['Customer experience','Conversion','Technology','Speed','Integrations','Migration','Growth','Scalability','Other'],investment:['$15k–$30k','$30k–$60k','$60k–$100k','$100k+','Ongoing optimisation','Not sure yet'],timeline:['Immediately','1–3 months','3–6 months','6+ months','Exploring options']};
  function validate(data,step){
    const errors={};const keys=Object.keys(choices);const key=keys[step];
    keys.forEach((name,i)=>{if(step!==undefined&&i!==step)return;if(name==='challenges'){if(!Array.isArray(data[name])||!data[name].length||data[name].length>choices[name].length||data[name].some(x=>!choices[name].includes(x)))errors[name]='Choose at least one challenge.';}else if(!choices[name].includes(data[name]))errors[name]='Choose an option to continue.';});
    if(step===undefined||step===5){
      for(const [name,max] of [['name',120],['company',150],['email',200]])if(typeof data[name]!=='string'||!data[name].trim()||data[name].length>max)errors[name]='Enter a valid '+name+'.';
      if(typeof data.email==='string'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))errors.email='Enter a valid email address.';
      if(data.type==='assessment'&&!data.website)errors.website='Enter the website to assess.';
      if(data.website){try{const url=new URL(data.website);if(!['https:','http:'].includes(url.protocol)||!url.hostname.includes('.')||data.website.length>2048)errors.website='Enter a complete website address beginning with https://.';}catch{errors.website='Enter a complete website address beginning with https://.';}}
      if(data.consent!==true)errors.consent='Confirm you have read the privacy information.';
      if(typeof data.message!=='string'||data.message.length>4000)errors.message='Keep additional details under 4,000 characters.';
      if(typeof data.phone!=='string'||data.phone.length>40)errors.phone='Keep the phone number under 40 characters.';
      if(!['project','assessment'].includes(data.type))errors.type='Choose a valid enquiry type.';
      if(data.company_fax)errors.form='Unable to process this brief.';
    }
    return errors;
  }
  return {choices,validate};
});
