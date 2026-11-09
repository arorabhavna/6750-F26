import {writeFileSync} from 'node:fs';

const root='https://omscs6750.gatech.edu/atlas/';
const decode=text=>text.replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#x27;|&#39;/g,"'").replace(/&quot;/g,'"').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).trim();
async function get(url){
  const response=await fetch(url);
  if(!response.ok)throw new Error(`${response.status} fetching ${url}`);
  return response.text();
}
const index=await get(root);
const lessons=new Map();
for(const match of index.matchAll(/<a href="(lesson-[^"]+\.html)">[\s\S]*?<div class="num">([^<]+)<\/div><div class="name">([^<]+)<\/div>/g)){
  lessons.set(match[2],{path:match[1],number:match[2],name:decode(match[3])});
}
if(lessons.size!==27)throw new Error(`Expected the 27 published ATLAS lessons; found ${lessons.size}. Review the source before refreshing.`);
const concepts={
  '1.1':['Human-Computer Interaction'],'1.2':['Course structure'],'1.3':['HCI applications'],
  '2.1':['User-centered design'],'2.2':['Feedback cycles','Gulf of execution','Gulf of evaluation'],
  '2.3':['Direct manipulation','Invisible interfaces'],'2.4':['Human abilities','Recognition and recall','Cognitive load','Memory'],
  '2.5':['Design principles','Heuristics','Affordances'],'2.6':['Mental models','Representations'],
  '2.7':['Task analysis'],'2.8':['Distributed cognition'],'2.9':['Interfaces and politics'],'2.10':['HCI principles'],
  '3.1':['Design life cycle'],'3.2':['Research ethics'],'3.3':['Needfinding','Requirements gathering'],
  '3.4':['Brainstorming','Design alternatives'],'3.5':['Prototyping','Fidelity'],
  '3.6':['Evaluation','Heuristic evaluation','Cognitive walkthroughs','Usability testing'],
  '3.7':['Agile development'],'3.8':['HCI methods'],'4.1':['Technologies'],'4.2':['Ideas'],'4.3':['Domains'],
  '5.1':['Course recap'],'5.2':['Related fields'],'5.3':['Next steps']
};
const resources=[];
for(const lesson of lessons.values()){
  const html=await get(root+lesson.path);
  const outline=/<aside class="rail">([\s\S]*?)<\/aside>/.exec(html)?.[1];
  if(!outline)throw new Error(`No course outline found for ${lesson.number}`);
  const sections=[...outline.matchAll(/<a href="#(s\d+)">([\s\S]*?)<\/a>/g)].map(m=>({id:m[1],title:decode(m[2]),text:''}));
  if(!sections.length)throw new Error(`Empty section list for ${lesson.number}`);
  const topics=sections.filter(s=>!/^Introduction|Conclusion|Exercise|Quiz|Reflections|Exploring|Design Challenge/.test(s.title)).slice(0,5).map(s=>s.title);
  resources.push({
    id:'atlas-'+lesson.number.replace('.','-'),title:`${lesson.number} ${lesson.name}`,type:'Reading',
    source:'CS6750 ATLAS',version:'v1',status:'external',concepts:concepts[lesson.number]||[lesson.name],
    lesson:`${lesson.number} ${lesson.name}`,summary:topics.join(' · '),sections,relatedIds:[],
    url:root+lesson.path,sourceUrl:root+lesson.path,
    sectionLinks:Object.fromEntries(sections.map(s=>[s.id,root+lesson.path+'#'+s.id]))
  });
}
const extra=(id,title,type,source,url,lesson,concepts,summary)=>({id,title,type,source,version:'v1',status:'external',concepts,lesson,summary,sections:[],relatedIds:[],url,sourceUrl:url});
resources.push({
  ...extra('youtube-recognition','Usability Heuristic 6: Recognition vs. Recall in User Interfaces','Video','Nielsen Norman Group · Supplemental video','https://www.youtube.com/watch?v=6glQPp6q4Jc','2.4 Human Abilities',['Recognition and recall','Memory'],'A public NN/g explanation of recognition and recall, paired with the CS6750 Human Abilities lesson.'),
  sourceUrl:'https://www.nngroup.com/videos/recognition-vs-recall/',relatedIds:['atlas-2-4','atlas-2-5']
});
resources.find(r=>r.id==='atlas-2-4').relatedIds=['youtube-recognition','atlas-2-5'];
resources.find(r=>r.id==='atlas-2-5').relatedIds=['youtube-recognition','atlas-2-4'];
resources.find(r=>r.id==='atlas-3-6').relatedIds=['atlas-3-5','canvas-individual-project','canvas-readings'];
resources.find(r=>r.id==='atlas-3-3').relatedIds=['atlas-3-2','atlas-3-4','canvas-individual-project'];
resources.push(
  extra('canvas-individual-project','Individual Project','Assignment','CS6750 · Canvas','https://gatech.instructure.com/courses/536416/assignments/2579744','Coursework',['Needfinding','Prototyping','Evaluation'],'The course assignment page for the individual HCI project. Open Canvas for the current instructions, rubric, and due date.'),
  extra('canvas-readings','Required Reading List','Reference','CS6750 · Canvas','https://gatech.instructure.com/courses/536416/pages/required-reading-list','Coursework',['Readings'],'The course reading list, with access to assigned material through Canvas.'),
  extra('canvas-formatting','Document Formatting and Submission','Reference','CS6750 · Canvas','https://gatech.instructure.com/courses/536416/pages/document-formatting-and-submission','Coursework',['JDF formatting','Submission'],'Course guidance on document format and submission.'),
  extra('course-overview','CS6750: Human-Computer Interaction','Reference','Georgia Tech OMSCS','https://omscs.gatech.edu/cs-6750-human-computer-interaction','Course information',['Course structure','Learning outcomes'],'Course goals, learning outcomes, preparation, and access to public course content.'),
  extra('ed-discussion','CS6750 Ed Discussion','Discussion','Ed Discussion','https://edstem.org/us/courses/102503','Coursework',['Discussion','Clarifications'],'Course announcements, questions, and teaching-team responses in the original discussion forum.')
);
resources.find(r=>r.id==='canvas-individual-project').relatedIds=['atlas-3-3','atlas-3-4','atlas-3-5','atlas-3-6','canvas-formatting'];
resources.find(r=>r.id==='canvas-readings').relatedIds=['atlas-3-6','atlas-2-4'];
const unitNames=['Introduction','HCI Principles','HCI Methods','Applications','Conclusion'];
const descriptions=[
  'Introduction to HCI, the course, and the range of human-computer interaction.',
  'Feedback, direct manipulation, human abilities, heuristics, mental models, and cognition.',
  'The design life cycle: research ethics, needfinding, alternatives, prototyping, and evaluation.',
  'Technologies, ideas, and domains in human-computer interaction.',
  'Course recap, related fields, and next steps.'
];
const collections=unitNames.map((name,i)=>({
  id:'course-unit-'+(i+1),title:`Unit ${i+1}: ${name}`,description:descriptions[i],kind:'course',owner:'CS6750',
  resourceIds:resources.filter(r=>r.id.startsWith(`atlas-${i+1}-`)).map(r=>r.id),
  requirements:{},updatedAt:'2026-11-09T00:00:00.000Z'
}));
collections.push({id:'course-coursework',title:'Coursework and Readings',description:'Original course pages for the individual project, readings, formatting, and discussion.',kind:'course',owner:'CS6750',resourceIds:['canvas-individual-project','canvas-readings','canvas-formatting','ed-discussion'],requirements:{},updatedAt:'2026-11-09T00:00:00.000Z'});
const data={revision:'cs6750-public-2026-11-09',resources,collections};
const ids=new Set(resources.map(r=>r.id));
for(const r of resources)for(const id of r.relatedIds)if(!ids.has(id))throw new Error(`Missing related resource ${id}`);
writeFileSync(new URL('course-catalog.js',import.meta.url),`window.CourseCatalog = ${JSON.stringify(data,null,2)};\n`,'utf8');
console.log(`Saved ${resources.length} verified-source resources and ${collections.length} course collections. Only titles, section headings, links, and original metadata summaries were stored.`);
