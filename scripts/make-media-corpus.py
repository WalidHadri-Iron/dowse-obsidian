"""Create deterministic accuracy fixtures. Requires ffmpeg and local Windows SAPI voices (run from Windows/WSL).
    python scripts/make-media-corpus.py --photos .cache/scratch/media-vault/photos --out .cache/release-validation/media-corpus
Ground truth comes from separately synthesized sections and measured durations, never from search results.
"""
import argparse, json, subprocess, shutil, wave
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('--photos',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
args=parser.parse_args();root=args.out.resolve();root.mkdir(parents=True,exist_ok=True)
spec=json.loads((Path(__file__).parent/'fixtures/media-corpus.json').read_text())
speech=root/'speech';speech.mkdir(exist_ok=True);jobs=[]
for i,item in enumerate(spec['audio']):
 for j,section in enumerate(item['sections']):jobs.append({'path':str(speech/f'{i:02}-{j:02}.wav'),'text':section['text'],'voice':'Microsoft Zira Desktop' if i%2==0 else 'Microsoft David Desktop'})
def win(path):
 s=str(path)
 if s.startswith('/'):return '\\\\wsl.localhost\\Ubuntu'+s.replace('/','\\')
 return s
jobs=[{**j,'path':win(Path(j['path']))} for j in jobs]
(root/'speech.json').write_text(json.dumps(jobs),encoding='utf8')
ps=root/'speech.ps1';json_path=win(root/'speech.json').replace("'","''")
ps.write_text("""$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = 0
$items = Get-Content -Raw -LiteralPath '"""+json_path+"""' | ConvertFrom-Json
foreach ($item in $items) {
 if (-not (Test-Path -LiteralPath $item.path)) {
  $s.SelectVoice($item.voice); $s.SetOutputToWaveFile($item.path); $s.Speak($item.text); $s.SetOutputToNull()
 }
}
$s.Dispose()
""",encoding='utf8')
subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',win(ps)],check=True)
def ffmpeg(arguments):subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',*map(str,arguments)],check=True)
truth={'description':spec['description'],'files':[],'queries':[]}
for i,item in enumerate(spec['audio']):
 destination=root/'vault/Audio'/item['name'];destination.parent.mkdir(parents=True,exist_ok=True)
 pcm=bytearray();sections=[];params=None
 for j,section in enumerate(item['sections']):
  with wave.open(str(speech/f'{i:02}-{j:02}.wav')) as f:
   if params is None:params=f.getparams()
   assert (f.getnchannels(),f.getsampwidth(),f.getframerate())==(params.nchannels,params.sampwidth,params.framerate)
   start=len(pcm)/(params.nchannels*params.sampwidth*params.framerate)
   pcm.extend(f.readframes(f.getnframes()))
   end=len(pcm)/(params.nchannels*params.sampwidth*params.framerate)
   sections.append({'start':start,'end':end})
   for query in section['queries']:truth['queries'].append({'q':query,'kind':'audio','expect':[{'path':'Audio/'+item['name'],'start':start,'end':end}]})
   pcm.extend(bytes(round(.6*params.framerate)*params.nchannels*params.sampwidth))
 merged=speech/f'merged-{i:02}.wav'
 with wave.open(str(merged),'wb') as f:f.setparams(params);f.writeframes(pcm)
 options=[]
 if destination.suffix=='.mp3':options=['-c:a','libmp3lame','-b:a','96k']
 elif destination.suffix=='.m4a':options=['-c:a','aac','-b:a','96k']
 elif destination.suffix=='.ogg':options=['-c:a','libvorbis','-q:a','4']
 ffmpeg(['-i',merged,'-ar','24000','-ac','1',*options,destination])
 truth['files'].append({'path':'Audio/'+item['name'],'kind':'audio','sections':sections})
for item in spec['video']:
 dest=root/'vault/Video'/item['name'];dest.parent.mkdir(parents=True,exist_ok=True)
 shots=[]
 for n,(name,query) in enumerate(item['shots']):
  source=args.photos/name
  if not source.is_file():raise RuntimeError('Missing owned testbed image '+str(source))
  shot=speech/(item['name']+f'-{n}.mp4')
  ffmpeg(['-loop','1','-i',source,'-t','6','-vf','scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2:color=white','-r','12','-c:v','libx264','-pix_fmt','yuv420p',shot])
  shots.append(shot)
  existing=next((q for q in truth['queries'] if q['kind']=='video' and q['q']==query),None)
  expect={'path':'Video/'+item['name'],'start':n*6,'end':(n+1)*6}
  if existing:existing['expect'].append(expect)
  else:truth['queries'].append({'q':query,'kind':'video','expect':[expect]})
 listing=speech/(item['name']+'.txt');listing.write_text('\n'.join("file '"+p.as_posix().replace("'","'\\''")+"'" for p in shots))
 ffmpeg(['-f','concat','-safe','0','-i',listing,'-c','copy',dest])
 truth['files'].append({'path':'Video/'+item['name'],'kind':'video'})
for q in spec['absent']:truth['queries'].append({'q':q,'kind':'audio','expect':[]})
(root/'truth.json').write_text(json.dumps(truth,indent=2),encoding='utf8')
print(f"Created {len(truth['files'])} media files and {len(truth['queries'])} independent queries in {root}")
