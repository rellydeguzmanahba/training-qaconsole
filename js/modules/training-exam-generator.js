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
  const [qs,linked,examRecords]=await Promise.all([rows('exam_questions',t=>t.select('*').order('created_at',{ascending:false}).limit(1000)),rows('exam_pool',t=>t.select('exam_id,question_id').limit(10000)),rows('exams',t=>t.select('id,title,created_at').order('created_at',{ascending:false}).limit(1000))]);
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
  const file=el('input',{type:'file',accept:'.pdf,.xlsx,.xls,.csv,.json,application/pdf,application/json,text/csv',style:'display:none'});
  const importer=el('button',{class:'btn btn--primary exam-import__button',type:'button',onclick:()=>file.click(),'aria-label':'Upload examination PDF or Excel file'},el('span',{class:'exam-import__icon','aria-hidden':'true'},'↑'),el('span',{},'Upload Examination'),el('span',{class:'exam-import__arrow','aria-hidden':'true'},'→'));
  const importCard=el('section',{class:'card exam-import__card stack'},el('div',{class:'exam-import__header'},el('div',{},el('span',{class:'exam-import__eyebrow'},'IMPORT EXAMINATION'),el('h3',{},'Upload an existing examination'),el('p',{class:'muted small'},'Bring your existing questions into the Question Bank. No AI generation.')),el('span',{class:'exam-import__badge'},'PDF · XLSX · XLS · CSV')),el('div',{class:'exam-import__actions'},importer,el('span',{class:'muted small'},'Maximum file size: 8 MB')),file);
  const review=el('div',{class:'stack exam-review__questions'});
  const modalStatus=el('p',{class:'muted small',role:'status'});
  const closeModal=el('button',{class:'btn',type:'button'},'Close');
  const modal=el('dialog',{class:'exam-review__dialog','aria-label':'Review imported examination'});
  const modalTitle=el('h2',{},'Review imported examination');
  const modalHeader=el('div',{class:'exam-review__header'},el('div',{},el('span',{class:'exam-import__eyebrow'},'IMPORT REVIEW'),modalTitle,el('p',{class:'muted small'},'Verify all questions and correct answers before saving.')),closeModal);
  const modalBody=el('div',{class:'exam-review__body'},modalStatus,review);
  const modalFooter=el('div',{class:'exam-review__footer'});
  modal.append(modalHeader,modalBody,modalFooter);
  const openModal=()=>{if(!modal.open)modal.showModal();};
  closeModal.addEventListener('click',()=>modal.close());
  modal.addEventListener('click',event=>{if(event.target===modal)modal.close();});
  modal.addEventListener('close',()=>importer.focus());
  const importHelp=el('p',{class:'muted small'},'Import existing questions without AI. Review each question and set its correct answer before saving. Scanned PDFs require a text-based copy.');
  const loadScript=async(url,key)=>{
    if(window[key])return window[key];
    await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.onload=resolve;s.onerror=()=>reject(Error('Could not load document reader.'));document.head.append(s);});
    if(!window[key])throw Error('Document reader unavailable.');return window[key];
  };
  const parseRows=(rows)=>{
    const clean=s=>String(s??'').trim();
    const norm=s=>clean(s).toLowerCase().replace(/[^a-z0-9]/g,'');
    const headers=rows[0].map(norm);
    const index=(...names)=>headers.findIndex(h=>names.includes(h));
    const qi=index('question','questiontext','tanong'),a=index('a','optiona','choicea','answera'),b=index('b','optionb','choiceb','answerb'),c=index('c','optionc','choicec','answerc'),d=index('d','optiond','choiced','answerd'),key=index('correctanswer','correct','answerkey','correctindex'),topic=index('topic','category'),diff=index('difficulty');
    if([qi,a,b,c,d].some(i=>i<0))throw Error('Spreadsheet headers required: Question, A, B, C, D. Optional: Correct Answer, Topic, Difficulty.');
    return rows.slice(1).filter(r=>clean(r[qi])).map(r=>{
      const raw=clean(r[key]),letters=['A','B','C','D'];
      let answer=/^[A-D]$/i.test(raw)?letters.indexOf(raw.toUpperCase()):/^[0-3]$/.test(raw)?Number(raw):null;
      return {question:clean(r[qi]),choices:[a,b,c,d].map(i=>clean(r[i])),correct_index:answer,topic:clean(r[topic])||'General',difficulty:clean(r[diff])||'medium'};
    });
  };
  const parsePdf=(lines)=>{
    const questions=[];let q=null;let choice=-1;
    const flush=()=>{if(q&&q.question&&q.choices.every(Boolean))questions.push(q);q=null;choice=-1;};
    for(const original of lines){
      const line=original.trim();if(!line)continue;
      const start=line.match(/^(?:Question\s*)?(\d{1,3})\s*[.)-]\s+(.+)/i);
      const option=line.match(/^([A-D])\s*[.)-]\s+(.+)/i);
      if(start){flush();q={question:start[2],choices:['','','',''],correct_index:null,topic:'Imported PDF',difficulty:'medium'};}
      else if(option&&q){choice=option[1].toUpperCase().charCodeAt(0)-65;q.choices[choice]=option[2];}
      else if(q){if(choice>=0)q.choices[choice]+=' '+line;else q.question+=' '+line;}
    }
    flush();return questions;
  };
  const readFile=async f=>{
    const ext=f.name.split('.').pop().toLowerCase();
    if(ext==='json'){const p=JSON.parse(await f.text());return Array.isArray(p)?p:p.questions;}
    if(['xlsx','xls','csv'].includes(ext)){
      const XLSX=await loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js','XLSX');
      const book=XLSX.read(await f.arrayBuffer(),{type:'array'});return parseRows(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:''}));
    }
    if(ext==='pdf'){
      const pdfjs=await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js','pdfjsLib');
      pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      const pdf=await pdfjs.getDocument({data:await f.arrayBuffer(),disableWorker:true}).promise;
      if(pdf.numPages>80)throw Error('PDF exceeds 80 pages.');
      const lines=[];
      for(let p=1;p<=pdf.numPages;p++){
        const page=await pdf.getPage(p),data=await page.getTextContent();
        const groups=new Map();
        for(const item of data.items){const y=Math.round(item.transform?.[5]||0);if(!groups.has(y))groups.set(y,[]);groups.get(y).push(item);}
        for(const [,items] of [...groups].sort((a,b)=>b[0]-a[0]))lines.push(items.sort((a,b)=>(a.transform?.[4]||0)-(b.transform?.[4]||0)).map(x=>x.str).join(' ').trim());
      }
      return parsePdf(lines);
    }
    throw Error('Unsupported file type.');
  };
  file.onchange=async()=>{
    try{
      const f=file.files?.[0];if(!f)return;if(f.size>8*1024*1024)throw Error('File exceeds 8 MB.');
      info('Reading '+f.name+'…');modalStatus.textContent='Reading '+f.name+'…';review.replaceChildren();
      const imported=await readFile(f);
      if(!Array.isArray(imported)||!imported.length||imported.length>500)throw Error('No complete four-choice questions found. For PDF, use numbered questions with A–D choices. Check the original formatting.');
      const drafts=imported.map(q=>({question:String(q.question||''),choices:Array.isArray(q.choices)?q.choices.map(String).slice(0,4):[],topic:String(q.topic||'General'),difficulty:['easy','medium','hard'].includes(q.difficulty)?q.difficulty:'medium',correct_index:Number.isInteger(q.correct_index)&&q.correct_index>=0&&q.correct_index<=3?q.correct_index:null}));
      const editors=drafts.map((q,i)=>{
        const text=el('textarea',{class:'input',rows:'2'});text.value=q.question;
        const opts=Array.from({length:4},(_,j)=>{const v=input('Choice '+String.fromCharCode(65+j));v.value=q.choices[j]||'';return v;});
        const answer=el('select',{class:'input'},el('option',{value:''},'Select verified correct answer'),...[0,1,2,3].map(j=>el('option',{value:j},String.fromCharCode(65+j))));
        answer.value=q.correct_index===null?'':String(q.correct_index);
        const category=input('Topic (optional)');category.value=q.topic;
        return {text,opts,answer,category,card:el('article',{class:'card stack exam-review__question-card'},el('div',{class:'exam-review__question-heading'},el('span',{class:'exam-review__question-number'},'QUESTION '+String(i+1).padStart(2,'0')),el('span',{class:'exam-review__question-tag'},'Review required')),el('div',{class:'exam-review__question-content'},field('Question text',text),el('div',{class:'exam-review__choices'},...opts.map((o,j)=>field('Choice '+String.fromCharCode(65+j),o))),el('div',{class:'exam-review__answer-area'},field('✓ Correct answer (required)',answer),field('Topic / Category',category))))};
      });
      const batchName=input('Question Bank folder / upload category');
      batchName.value=f.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim();
      const examName=input('Examination title');
      examName.value=f.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim();
      const examPassing=input('Passing score (%)','number');examPassing.value='80';
      const examDuration=input('Duration (minutes)','number');examDuration.value='60';
      const examAttempts=input('Allowed attempts','number');examAttempts.value='1';
      const settings=el('section',{class:'card stack exam-review__settings'},el('h3',{},'Examination draft details'),field('Question Bank category (file name)',batchName),field('Examination title',examName),el('div',{class:'exam-review__settings-grid'},field('Passing score (%)',examPassing),field('Duration (minutes)',examDuration),field('Allowed attempts',examAttempts)),el('p',{class:'muted small'},'Importing creates one draft examination. You can assign technicians and activate it afterward.'));
      const save=btn('Import Examination',async()=>{
        try{
          const payload=editors.map(x=>({question:x.text.value.trim(),choices:x.opts.map(o=>o.value.trim()),correct_index:x.answer.value===''?null:Number(x.answer.value),topic:x.category.value.trim()||'General',difficulty:'medium'}));
          const bad=payload.findIndex(q=>!q.question||q.choices.length!==4||q.choices.some(x=>!x)||q.correct_index===null);
          if(bad>=0){editors[bad].card.scrollIntoView({behavior:'smooth',block:'start'});editors[bad].card.classList.add('exam-review__invalid');editors[bad].answer.focus({preventScroll:true});throw Error('Review question '+(bad+1)+': all choices and a verified correct answer are required.');}
          const batch=batchName.value.trim();if(!batch||batch.length>120)throw Error('Enter a Question Bank category (maximum 120 characters).');
          payload.forEach(q=>q.topic=batch);
          const title=examName.value.trim(),passing=Number(examPassing.value),duration=Number(examDuration.value),attempts=Number(examAttempts.value);
          if(!title||title.length>160)throw Error('Enter an examination title (maximum 160 characters).');
          if(!Number.isFinite(passing)||passing<1||passing>100)throw Error('Passing score must be 1–100%.');
          if(!Number.isInteger(duration)||duration<1||duration>480)throw Error('Duration must be 1–480 minutes.');
          if(!Number.isInteger(attempts)||attempts<1||attempts>20)throw Error('Allowed attempts must be 1–20.');
          if(!confirm('Create draft examination "'+title+'" with '+payload.length+' verified questions?'))return;
          save.disabled=true;save.textContent='Creating examination…';
          try{
            const {data:inserted,error:questionError}=await sb.from('exam_questions').insert(payload).select('id');
            if(questionError)throw questionError;
            if(!inserted||inserted.length!==payload.length)throw Error('Could not verify imported question IDs. No exam draft was created.');
            const {data:exam,error:examError}=await sb.from('exams').insert({title,question_count:payload.length,passing_percent:passing,duration_minutes:duration,max_attempts:attempts,active:false}).select('id').single();
            if(examError)throw Error('Questions imported, but examination draft creation failed: '+examError.message);
            const {error:poolError}=await sb.from('exam_pool').insert(inserted.map(q=>({exam_id:exam.id,question_id:q.id})));
            if(poolError)throw Error('Draft created, but attaching questions failed: '+poolError.message+'. Check this draft before activating.');
            modal.close();info('Created draft examination "'+title+'" with '+payload.length+' questions. Open Examinations to assign and activate it.');
            show('Examinations',exams);
          }finally{save.disabled=false;save.textContent='Import Examination';}
        }catch(e){modalStatus.textContent='Error: '+String(e.message||e);err(e);}
      });
      save.textContent='Import Examination';
      save.classList.add('exam-review__import-button');
      const cancel=btn('Cancel',()=>modal.close());
      modalFooter.replaceChildren(el('span',{class:'exam-review__footer-note'},'✓ '+editors.length+' questions ready for review'),el('div',{class:'exam-review__footer-actions'},cancel,save));
      review.append(settings,...editors.map(x=>x.card));
      modalTitle.textContent='Review '+editors.length+' imported questions';
      modalStatus.textContent=f.name+' · '+editors.length+' questions extracted. Verify every answer before saving.';
      info('Imported '+editors.length+' questions from '+f.name+'. Review in the popup.');
      openModal();
    }catch(e){err(e);}finally{file.value='';}
  };
  const list=el('section',{class:'card stack exam-bank'});
  const search=input('Search question content','search');
  search.setAttribute('aria-label','Search Question Bank');
  const count=el('p',{class:'muted small'});
  const folders=el('div',{class:'stack exam-bank__folders'});
  const linkMap=new Map();
  linked.forEach(x=>{if(!linkMap.has(x.question_id))linkMap.set(x.question_id,new Set());linkMap.get(x.question_id).add(x.exam_id);});
  const linkedExam=new Map(examRecords.map(x=>[x.id,x]));
  const categoryFor=q=>{
    const names=[...(linkMap.get(q.id)||[])].map(id=>linkedExam.get(id)?.title).filter(Boolean);
    if(q.topic&&q.topic!=='General'&&q.topic!=='Imported PDF')return q.topic;
    return names[0]||'Uncategorized / Manual Questions';
  };
  const draw=()=>{
    const term=search.value.trim().toLowerCase(),batches=new Map();
    qs.forEach(q=>{
      const name=categoryFor(q);
      if(term&&![name,q.question,...q.choices].some(v=>String(v).toLowerCase().includes(term)))return;
      if(!batches.has(name))batches.set(name,[]);
      batches.get(name).push(q);
    });
    folders.replaceChildren();
    const matched=[...batches.values()].reduce((n,items)=>n+items.length,0);
    count.textContent=batches.size+' categories · '+matched+' questions';
    if(!batches.size){folders.append(el('p',{class:'muted'},'No matching categories or questions.'));return;}
    [...batches.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([name,items])=>{
      const body=el('div',{class:'stack exam-bank__folder-body'});
      items.forEach((q,i)=>{
        const remove=btn('Delete question',async event=>{
          event?.stopPropagation?.();
          try{
            const associations=linkMap.get(q.id);
            if(associations?.size)throw Error('This question belongs to an examination. Delete its draft examination first, then remove the question from the Question Bank.');
            if(!confirm('Permanently delete this question from "'+name+'"?'))return;
            const {error}=await sb.from('exam_questions').delete().eq('id',q.id);
            if(error)throw error;
            info('Question deleted.');await questions();
          }catch(e){err(e);}
        });
        remove.classList.add('exam-delete__button');
        const details=el('details',{class:'exam-bank__question'},
          el('summary',{},el('span',{class:'exam-bank__index'},String(i+1).padStart(2,'0')),el('span',{class:'exam-bank__question-text'},q.question)),
          el('div',{class:'exam-bank__question-body'},el('ol',{},q.choices.map((c,j)=>el('li',{class:j===q.correct_index?'exam-bank__correct':''},c+(j===q.correct_index?' ✓':'')))),el('div',{class:'row'},remove)));
        body.append(details);
      });
      const batchExams=examRecords.filter(e=>e.title===name);
      const actions=el('div',{class:'exam-bank__folder-actions'});
      const unlinkable=items.every(q=>!linkMap.get(q.id)?.size);
      if(unlinkable){
        const deleteBatch=btn('Delete category and '+items.length+' questions',async()=>{
          try{
            if(!confirm('Permanently delete "'+name+'" and all '+items.length+' questions? This cannot be undone.'))return;
            const ids=items.map(q=>q.id);
            const {error}=await sb.from('exam_questions').delete().in('id',ids);
            if(error)throw error;
            info('Deleted category "'+name+'".');await questions();
          }catch(e){err(e);}
        });
        deleteBatch.classList.add('exam-delete__button');actions.append(deleteBatch);
      }else{
        actions.append(el('p',{class:'muted small'},'Contains questions linked to examinations. Delete the associated draft in Examinations before deleting these questions.'));
      }
      const folder=el('details',{class:'exam-bank__folder'},el('summary',{},el('span',{class:'exam-bank__folder-icon'},'▣'),el('span',{class:'exam-bank__folder-title'},name),el('span',{class:'exam-bank__folder-count'},items.length+' questions')),body,actions);
      folders.append(folder);
    });
  };
  search.addEventListener('input',draw);
  list.append(el('div',{class:'exam-bank__heading'},el('h3',{},'Question Bank Categories'),el('p',{class:'muted small'},'Each imported file creates a named category. Open a folder to view its questions and answers.')),search,count,folders);
  draw();
  const manual=el('details',{class:'card exam-manual'},el('summary',{},'＋ Add a question manually'),editor);
  panel.append(importCard,modal,list,manual);
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
  const manualDraft=el('details',{class:'card exam-manual'},el('summary',{},'＋ Advanced: Build an examination from existing questions'),el('div',{class:'stack'},el('h3',{},'Optional: Build examination from existing Question Bank'),el('p',{class:'muted small'},'Only use this if you want to combine previously saved questions. Uploaded files already create a draft automatically.'),field('Title',title),field('Questions per attempt',count),field('Passing score (%)',passing),field('Duration (minutes)',duration),field('Allowed attempts',attempts),pool,create));
  const listing=el('div',{class:'stack'},el('h3',{},'Saved examinations'));
  let employees=[];
  try{employees=await rows('profiles',t=>t.select('user_id,full_name,role,active').eq('role','technician').eq('active',true).order('full_name').limit(1000));}
  catch(e){info('Could not load employee directory: '+String(e.message||e));}
  const employeeList=el('datalist',{id:'exam-employee-lookup'});
  employees.forEach(p=>employeeList.append(el('option',{value:p.full_name})));
  listing.append(employeeList);
  ex.forEach(e=>{
   const search=input('Search employee name','search');
   search.setAttribute('list','exam-employee-lookup');
   search.setAttribute('aria-label','Search active employee by name');
   const assign=btn('Assign employee',async()=>{try{
    const term=search.value.trim();
    const matches=employees.filter(p=>p.full_name.toLowerCase()===term.toLowerCase());
    if(matches.length>1)throw Error('Multiple employees share this name. Please contact an administrator to distinguish their accounts.');
    const match=matches[0];
    if(!match)throw Error('Select an active employee from the suggestions. If missing, confirm their portal account is active.');
    const {error}=await sb.from('exam_assignments').upsert({exam_id:e.id,user_id:match.user_id});if(error)throw error;
    info('Assigned '+match.full_name+' to '+e.title+'.');
   }catch(x){err(x);}});
   const toggle=btn(e.active?'Pause examination':'Activate examination',async()=>{try{const {error}=await sb.from('exams').update({active:!e.active}).eq('id',e.id);if(error)throw error;await exams();}catch(x){err(x);}});
   const remove=btn('Delete draft',async()=>{try{
    if(e.active)throw Error('Pause this examination before deleting it.');
    const {data:attempts,error:checkError}=await sb.from('exam_attempts').select('id').eq('exam_id',e.id).limit(1);
    if(checkError)throw checkError;
    if(attempts.length)throw Error('This examination has attempt history and cannot be deleted. Keep it paused to preserve results.');
    if(!confirm('Permanently delete draft "'+e.title+'"? This removes the draft and its assignments, but keeps shared Question Bank questions.'))return;
    const {data,error}=await sb.from('exams').delete().eq('id',e.id).eq('active',false).select('id');
    if(error)throw error;if(!data?.length)throw Error('Could not delete the draft.');
    info('Deleted draft "'+e.title+'".');await exams();
   }catch(x){err(x);}});
   remove.classList.add('exam-delete__button');
   const card=el('article',{class:'card stack exam-saved__card'},
    el('div',{class:'exam-saved__heading'},el('div',{},el('strong',{},e.title),el('p',{class:'muted small'},e.question_count+' questions · '+e.passing_percent+'% passing · '+e.duration_minutes+' min · '+(e.active?'Active':'Draft')))),
    field('Assign an existing employee',search),
    el('p',{class:'muted small'},employees.length?'Start typing a name and choose an employee from the suggestions.':'No active technician accounts available in the employee directory.'),
    el('div',{class:'row'},assign,toggle,...(e.active?[]:[remove])));
   listing.append(card);
  });
  panel.append(listing,manualDraft);
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
 const tabButtons=new Map();
 const heading=el('div',{class:'exam-hub__intro'},el('div',{},el('span',{class:'exam-hub__eyebrow'},'AHBA • TRAINING & QUALITY'),el('h3',{},'Examination Workspace'),el('p',{class:'muted small'},'Upload and organize assessments, assign employees, and monitor examination results.')));
 const summary=el('div',{class:'exam-hub__metrics'});
 const sectionHead=el('div',{class:'exam-hub__section-head'});
 const sectionTitle=el('h3',{},'');
 const sectionHelp=el('p',{class:'muted small'});
 sectionHead.append(sectionTitle,sectionHelp);
 const descriptions={
  'Question Bank':['Question Bank','Organize uploaded examinations into named folders. Expand a folder to review or delete questions.'],
  'Examinations':['Manage Examinations','Manage saved drafts, assign employees by name, and activate or pause assessments.'],
  'Results':['Examination Results','Review scores and completed examination attempts.'],
  'Take Exam':['My Examinations','Open an assigned assessment and complete it within the allotted time.']
 };
 async function refreshSummary(){
  if(!trainer)return;
  try{
   const [questionsCount,examRows,attemptsCount]=await Promise.all([
    sb.from('exam_questions').select('id',{count:'exact',head:true}),
    sb.from('exams').select('id,active').limit(1000),
    sb.from('exam_attempts').select('id',{count:'exact',head:true})
   ]);
   if(questionsCount.error||examRows.error||attemptsCount.error)return;
   const metrics=[
    ['Questions',questionsCount.count??0,'Question Bank'],
    ['Drafts',examRows.data.filter(e=>!e.active).length,'Examinations'],
    ['Active exams',examRows.data.filter(e=>e.active).length,'Examinations'],
    ['Attempts',attemptsCount.count??0,'Results']
   ];
   summary.replaceChildren(...metrics.map(([label,value,target])=>{
    const card=el('button',{class:'exam-hub__metric',type:'button',onclick:()=>selectTab(target)},el('span',{class:'exam-hub__metric-label'},label),el('strong',{},String(value)),el('span',{class:'exam-hub__metric-link'},'View details →'));
    return card;
   }));
  }catch(e){/* Summary is optional; keep the workspace usable. */}
 }
 function selectTab(label){
  const fn={ 'Question Bank':questions,'Examinations':exams,'Results':results,'Take Exam':take }[label];
  if(!fn)return;
  for(const [name,button] of tabButtons){const active=name===label;button.classList.toggle('is-active',active);button.setAttribute('aria-selected',String(active));}
  const [title,help]=descriptions[label];sectionTitle.textContent=title;sectionHelp.textContent=help;
  status.textContent='';panel.replaceChildren(el('div',{class:'exam-hub__loading'},'Loading '+title+'…'));
  fn().then(()=>refreshSummary()).catch(e=>{panel.replaceChildren();err(e);});
 }
 function show(label,fn){selectTab(label);}
 const navItems=trainer?[
  ['Question Bank','▤','Organize files'],
  ['Examinations','▣','Drafts & assignments'],
  ['Results','▥','Scores & attempts'],
  ['Take Exam','▶','Preview employee view']
 ]:[['Take Exam','▶','My assigned exams']];
 for(const [label,icon,sub] of navItems){
  const button=el('button',{class:'exam-hub__tab',type:'button',role:'tab','aria-selected':'false',onclick:()=>selectTab(label)},el('span',{class:'exam-hub__tab-icon'},icon),el('span',{class:'exam-hub__tab-label'},el('strong',{},label),el('small',{},sub)));
  tabButtons.set(label,button);tabs.append(button);
 }
 tabs.classList.add('exam-hub__tabs');tabs.setAttribute('role','tablist');
 root.append(el('div',{class:'stack exam-workspace exam-hub'},heading,...(trainer?[summary]:[]),tabs,sectionHead,status,panel));
 selectTab(trainer?'Question Bank':'Take Exam');
}
