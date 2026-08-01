import fs from 'node:fs/promises';
import path from 'node:path';
import { SDLCEngine, type SDLCPlan } from './engine';

export class SDLCPlanStore {
  constructor(private readonly workspaceRoot:string){}
  private get target():string{return path.join(this.workspaceRoot,'.keystone','state','sdlc','active-plan.json')}
  private get intentRoot():string{return path.join(this.workspaceRoot,'.keystone','state','intents')}
  async read():Promise<SDLCPlan|undefined>{
    try {
      const parsed=JSON.parse(await fs.readFile(this.target,'utf8')) as Partial<SDLCPlan>;
      if(!parsed.intent || !parsed.id || !parsed.intentId || !Array.isArray(parsed.stories)) return undefined;
      if(parsed.researchDocument && Array.isArray(parsed.backlogStories) && parsed.source) return parsed as SDLCPlan;
      const generated=new SDLCEngine().createPlan(parsed.intent);
      return {
        ...generated,
        ...parsed,
        source: parsed.source ?? {kind:'local'},
        researchDocument: parsed.researchDocument ?? {...generated.researchDocument,id:`research-${parsed.intentId}`},
        backlogStories: parsed.backlogStories ?? generated.backlogStories,
        stories: parsed.stories as SDLCPlan['stories'],
      };
    } catch{return undefined}
  }
  async write(plan:SDLCPlan):Promise<void>{
    await atomicWrite(this.target,`${JSON.stringify(plan,null,2)}\n`);
    const root=path.join(this.intentRoot,plan.intentId);
    await Promise.all([
      atomicWrite(path.join(root,'research.md'),`${plan.researchDocument.markdown}\n`),
      atomicWrite(path.join(root,'backlog-stories.json'),`${JSON.stringify(plan.backlogStories,null,2)}\n`),
      atomicWrite(path.join(root,'plan.json'),`${JSON.stringify(plan,null,2)}\n`),
    ]);
  }
  async clear():Promise<void>{await fs.rm(this.target,{force:true})}
}

async function atomicWrite(target:string,content:string):Promise<void>{
  const temporary=`${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(temporary,content,'utf8');
  await fs.rename(temporary,target);
}
