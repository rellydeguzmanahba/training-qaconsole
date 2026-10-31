import { el } from '../utils/dom.js';

// No AI APIs. All persisted records are stored in Supabase with RLS.
export function renderExamGenerator(root, ctx) {
 const sb=ctx.sb, trainer=['admin','trainer'].includes(ctx.role);
 const status=el('p',{class:'muted small',role:'status'});
 const panel=el('div',{class:'stack'});
 const tabs=el('div',{class:'row'});
 const btn=(label,fn)=>el('button',{class:'btn',type:'button',onclick:fn},label);
 const field=(label,node)=>el('label',{class:'stack small'},label,node);
 const input=(placeholder,type='text')=>el('input',{class:'input',type,placeholder});
 const info=(message)=>{status.textContent=message;};
 const err=(e)=>info('Error: '+String(e.message||e));
 async function rows(table,query){const {data,error}=await query(sb.from(table));if(error)throw error;return data||[];}
 async function questions(){
  panel.replaceChildren();
  const qs=await rows('exam_questions',t=>t.select('*').order('created_at',{ascending:false}).limit(500));
  const topic=input('Topic / Category'),question=el('textarea',{class:'input',rows:'3',placeholder:'Question (English / Filipino)'});
  const choices=Array.from({length:4},(_,i)=>input('Choice '+String.fromCharCode(65+i)));
  const correct=el('select',{class:'input'},...[0,1,2,3].map(i=>el('option',{value:i},'Correct answer: '+String.fromCharCode(65+i))));
  const difficulty=el('select',{class:'input'},...['easy','medium','hard'].map(s=>el('option',{value:s},s)));
  const save=btn('Save question',async()=>{
   try{
    if(!question.value.trim()||choices.some(c=>!c.value.trim()))throw Error('Enter the question and all four choices.');
    const {error}=await sb.from('exam_questions').insert({topic:topic.value.trim()||'General',question:question.value.trim(),choices:choices.map(c=>c.value.trim()),correct_index:Number(correct.value),difficulty:difficulty.value});
    if(error)throw error;info('Question saved.');await questions();
   }catch(e){err(e);}
  });
  const editor=el('div',{class:'card stack'},el('h3',{},'Add a question'),field('Topic',topic),field('Question',question),...choices.map((c,i)=>field('Answer '+String.fromCharCode(65+i),c)),field('Answer key',correct),field('Difficulty',difficulty),save);
  const file=el('input',{type:'file',accept:'.json,application/json'});
  const importer=btn('Import JSON',()=>file.click());
  file.onchange=async()=>{
   try{
    const f=file.files?.[0];if(!f)return;if(f.size>3e6)throw Error('File exceeds 3 MB.');
    const parsed=JSON.parse(await f.text()),list=Array.isArray(parsed)?parsed:parsed.questions;
    if(!Array.isArray(list)||list.length<1||list.length>500)throw Error('Expected 1–500 questions.');
    const valid=list.every(q=>typeof q.question==='string'&&q.question.trim()&&Array.isArray(q.choices)&&q.choices.length===4&&q.choices.every(x=>typeof x==='string'&&x.trim())&&Number.isInteger(q.correct_index)&&q.correct_index>=0&&q.correct_index<=3);
    if(!valid)throw Error('Each question needs four choices and a verified correct_index (0–3).');
    if(!confirm('Import '+list.length+' questions? Confirm the answer keys have been reviewed.'))return;
    const payload=list.map(q=>({topic:String(q.topic||parsed.topic||'General').slice(0,160),question:q.question,choices:q.choices,correct_index:q.correct_index,difficulty:['easy','medium','hard'].includes(q.difficulty)?q.difficulty:'medium'}));
    const {error}=await sb.from('exam_questions').insert(payload);if(error)throw error;
    info('Imported '+payload.length+' verified questions.');await questions();
   }catch(e){err(e);}finally{file.value='';}
  };
  const list=el('div',{class:'stack'},el('div',{class:'row'},el('h3',{},'Question Bank ('+qs.length+')'),importer,file));
  qs.forEach((q,i)=>list.append(el('article',{class:'card stack'},el('strong',{},(i+1)+'. '+q.question),el('p',{class:'muted small'},q.topic+' · '+q.difficulty),el('ol',{},q.choices.map((c,j)=>el('li',{},j===q.correct_index?c+' ✓':c))),btn(q.active?'Deactivate':'Reactivate',async()=>{try{const {error}=await sb.from('exam_questions').update({active:!q.active}).eq('id',q.id);if(error)throw error;await questions();}catch(e){err(e);}}))));
  panel.append(editor,list);
 }
 async function exams(){
  panel.replaceChildren();
  const [qs,ex]=await Promise.all([rows('exam_questions',t=>t.select('id,topic,active').eq('active',true).limit(1000)),rows('exams',t=>t.select('*').order('created_at',{ascending:false}))]);
  const title=input('Examination title'),count=input('Questions per attempt','number'),passing=input('Passing percentage','number'),duration=input('Minutes','number'),attempts=input('Maximum attempts','number');
  count.value='50';passing.value='80';duration.value='60';attempts.value='1';
  const pool=el('div',{class:'stack'},el('p',{class:'muted small'},'Select topics to include in the examination pool.'));
  const topics=[...new Set(qs.map(q=>q.topic))];
  const checks=topics.map(t=>{const box=el('input',{type:'checkbox',checked:true});pool.append(field(t+' ('+qs.filter(q=>q.topic===t).length+')',box));return {topic:t,box};});
  const create=btn('Create draft examination',async()=>{
   try{
    const selected=qs.filter(q=>checks.some(x=>x.topic===q.topic&&x.box.checked));
    const n=Number(count.value);if(!title.value.trim()||!Number.isInteger(n)||n<1||n>200||selected.length<n)throw Error('Enter a title and select at least '+n+' active questions.');
    const {data,error}=await sb.from('exams').insert({title:title.value.trim(),question_count:n,passing_percent:Number(passing.value),duration_minutes:Number(duration.value),max_attempts:Number(attempts.value),active:false}).select('id').single();if(error)throw error;
    const {error:poolError}=await sb.from('exam_pool').insert(selected.map(q=>({exam_id:data.id,question_id:q.id})));
    if(poolError)throw Error('Exam created, but question pool failed: '+poolError.message);
    info('Draft exam created. Assign technicians and activate it when ready.');await exams();
   }catch(e){err(e);}
  });
  panel.append(el('div',{class:'card stack'},el('h3',{},'Create examination'),field('Title',title),field('Questions per attempt',count),field('Passing score (%)',passing),field('Duration (minutes)',duration),field('Allowed attempts',attempts),pool,create));
  const listing=el('div',{class:'stack'},el('h3',{},'Saved examinations'));
  ex.forEach(e=>{
   const user=input('Employee Supabase auth user UUID');
   const assign=btn('Assign technician',async()=>{try{const id=user.value.trim();if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Enter the technician auth user UUID.');const {error}=await sb.from('exam_assignments').upsert({exam_id:e.id,user_id:id});if(error)throw error;info('Technician assigned.');}catch(x){err(x);}});
   const toggle=btn(e.active?'Pause examination':'Activate examination',async()=>{try{const {error}=await sb.from('exams').update({active:!e.active}).eq('id',e.id);if(error)throw error;await exams();}catch(x){err(x);}});
   listing.append(el('div',{class:'card stack'},el('strong',{},e.title),el('p',{class:'muted small'},e.question_count+' questions · '+e.passing_percent+'% passing · '+e.duration_minutes+' min · '+(e.active?'Active':'Draft')),field('Assign by auth user ID',user),el('div',{class:'row'},assign,toggle)));
  });
  panel.append(listing);
 }
 async function take(){
  panel.replaceChildren();
  const assigned=await rows('exam_assignments',t=>t.select('exam_id,exams(id,title,question_count,duration_minutes,active)').limit(100));
  for(const x of assigned){
   const e=x.exams;if(!e?.active)continue;
   panel.append(el('div',{class:'card stack'},el('strong',{},e.title),el('p',{class:'muted small'},e.question_count+' questions · '+e.duration_minutes+' minutes'),btn('Start / Resume',async()=>{
    try{
     const {data,error}=await sb.rpc('exam_start',{p_exam_id:e.id});if(error)throw error;
     const answers={},area=el('div',{class:'stack'}),deadline=new Date(data.deadline).getTime();
     const timer=el('p',{class:'muted small'});let done=false;
     const submit=async()=>{if(done)return;done=true;clearInterval(interval);
      try{const {data:result,error:failure}=await sb.rpc('exam_submit',{p_attempt_id:data.attempt_id,p_answers:answers});if(failure)throw failure;panel.replaceChildren(el('div',{class:'card'},'Score: '+result.score+'/'+result.total+' — '+(result.passed?'PASSED':'FAILED')));}
      catch(z){done=false;err(z);}
     };
     data.questions.forEach(q=>{
      const card=el('div',{class:'card stack'},el('strong',{},q.position+'. '+q.question));
      q.choices.forEach((choice,i)=>{const radio=el('input',{type:'radio',name:'exam-'+data.attempt_id+'-'+q.position,value:i});radio.onchange=()=>{answers[q.position]=i;};card.append(field(String.fromCharCode(65+i)+'. '+choice,radio));});
      area.append(card);
     });
     const interval=setInterval(()=>{const left=Math.max(0,Math.ceil((deadline-Date.now())/1000));timer.textContent='Remaining: '+Math.floor(left/60)+':'+String(left%60).padStart(2,'0');if(left===0){clearInterval(interval);submit();}},1000);
     panel.replaceChildren(timer,area,btn('Submit examination',()=>{if(confirm('Submit your examination now?'))submit();}));
    }catch(z){err(z);}
   })));
  }
  if(!panel.childElementCount)panel.append(el('div',{class:'card'},'No active examinations assigned to your account.'));
 }
 async function results(){
  panel.replaceChildren();
  const r=await rows('exam_attempts',t=>t.select('exam_id,user_id,attempt_number,score,total,passed,submitted_at').order('started_at',{ascending:false}).limit(100));
  panel.append(el('h3',{},'Recent examination attempts'),...r.map(a=>el('div',{class:'card'},(a.user_id||'')+' · '+(a.score??'Pending')+'/'+(a.total??'—')+' · '+(a.passed===null?'In progress':a.passed?'Passed':'Failed')+' · '+(a.submitted_at||''))));
 }
 function show(label,fn){tabs.querySelectorAll('button').forEach(b=>b.disabled=b.textContent===label);panel.replaceChildren();fn().catch(err);}
 if(trainer){tabs.append(btn('Question Bank',()=>show('Question Bank',questions)),btn('Examinations',()=>show('Examinations',exams)),btn('Results',()=>show('Results',results)));}
 tabs.append(btn('Take Exam',()=>show('Take Exam',take)));
 root.append(el('div',{class:'stack exam-workspace'},tabs,status,panel));
 if(trainer)show('Question Bank',questions);else show('Take Exam',take);
}
