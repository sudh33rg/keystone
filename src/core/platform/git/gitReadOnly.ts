import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync=promisify(execFile);
const READ_ONLY_COMMANDS=new Set(['diff','status','rev-parse','branch','log','show','ls-files','remote']);
export class GitReadOnly {
  constructor(private readonly workspaceRoot:string){}
  async run(command:string,args:readonly string[]=[]):Promise<string>{
    if(!READ_ONLY_COMMANDS.has(command))throw new Error(`Git command is not allowed by Keystone read-only policy: ${command}`);
    if(args.some(arg=>/^(?:--exec|--upload-pack|--receive-pack|--config-env)$/i.test(arg)))throw new Error('Unsafe Git argument rejected.');
    try{const result=await execFileAsync('git',[command,...args],{cwd:this.workspaceRoot,maxBuffer:10*1024*1024,encoding:'utf8',windowsHide:true});return result.stdout.trim();}
    catch(error){const code=(error as NodeJS.ErrnoException).code;if(code==='ENOENT')return'';const stderr=(error as {stderr?:string}).stderr??'';if(/not a git repository/i.test(stderr))return'';throw error;}
  }
  diff():Promise<string>{return this.run('diff',['--no-ext-diff','--unified=1','HEAD']);}
  branch():Promise<string>{return this.run('rev-parse',['--abbrev-ref','HEAD']);}
  status():Promise<string>{return this.run('status',['--porcelain=v1','--untracked-files=all']);}
}
