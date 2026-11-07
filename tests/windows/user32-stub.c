/* Stand-in for user32/kernel32 on Linux: logs every input call the worker makes. Used by input-worker.e2e.sh */
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <wchar.h>
static const char* dir(){ const char* d=getenv("STUB_DIR"); return d?d:"."; }
static FILE* L(){ static FILE* f=0; if(!f){ char p[512]; snprintf(p,sizeof p,"%s/calls.log",dir()); f=fopen(p,"a"); } return f; }
typedef struct { uint16_t vk, scan; uint32_t flags, time; uint64_t extra; } KBD;
static int failing(){ char p[512]; snprintf(p,sizeof p,"%s/fail_sendinput",dir()); return access(p,0)==0; }
void mouse_event(uint32_t f,int32_t dx,int32_t dy,uint32_t d,uint64_t e){ fprintf(L(),"mouse_event flags=%u dx=%d dy=%d\n",f,dx,dy); fflush(L()); }
void keybd_event(uint8_t vk,uint8_t scan,uint32_t flags,uint64_t extra){ fprintf(L(),"keybd_event vk=0x%02X scan=0x%02X flags=%u\n",vk,scan,flags); fflush(L()); }
uint32_t MapVirtualKey(uint32_t code,uint32_t type){ return code==0x1B?0x01:(code&0x7F); }
uint32_t SendInput(uint32_t n, uint8_t* p, int size){
  if(failing()){ fprintf(L(),"SendInput REJECTED n=%u\n",n); fflush(L()); return 0; }
  fprintf(L(),"SendInput n=%u cbSize=%d\n", n, size);
  for(uint32_t i=0;i<n;i++){ uint8_t* q=p+i*size; uint32_t type=*(uint32_t*)q; KBD* k=(KBD*)(q+8);
    if(type==1) fprintf(L(),"  KEY vk=0x%02X scan=0x%04X flags=%u\n",k->vk,k->scan,k->flags);
    else fprintf(L(),"  MOUSE flags=%u\n",*(uint32_t*)(q+8+12)); }
  fflush(L()); return n; }
void* GetForegroundWindow(void){ return (void*)1234; }
int16_t GetAsyncKeyState(int k){ return 0; }
/* clipboard + kernel32 memory, in-process */
static uint16_t clip[4096]; static int clipHas=0; static int open_=0;
int OpenClipboard(void* o){ open_=1; return 1; } int CloseClipboard(void){ open_=0; return 1; }
int EmptyClipboard(void){ clipHas=0; clip[0]=0; return 1; }
int IsClipboardFormatAvailable(uint32_t f){ return clipHas; }
void* GetClipboardData(uint32_t f){ return clipHas? (void*)clip : 0; }
void* GlobalAlloc(uint32_t fl,size_t n){ return calloc(1,n); }
void* GlobalLock(void* m){ return m; } int GlobalUnlock(void* m){ return 1; }
void* SetClipboardData(uint32_t f,void* mem){ /* UTF-16 -> wchar (Linux wchar is 32-bit) */
  uint16_t* s=(uint16_t*)mem; int i=0; while(s[i]&&i<4000){ clip[i]=s[i]; i++; } clip[i]=0; clipHas=1;
  fprintf(L(),"SetClipboardData len=%d first=%c\n",i,i?(char)clip[0]:'-'); fflush(L()); return mem; }
