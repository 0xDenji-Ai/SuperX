'use strict';
const {MAX_FRAME,failure}=require('./policy.cjs');
function encode(message) {
  const body=Buffer.from(JSON.stringify(message),'utf8');
  if(body.length>MAX_FRAME)throw failure('BUILD_LIMIT');
  const header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);
}
class Decoder {
  constructor(onMessage,onError) { this.buffer=Buffer.alloc(0);this.onMessage=onMessage;this.onError=onError;this.failed=false; }
  push(chunk) {
    if(this.failed)return;
    // A chunk may contain several valid messages, so consume before retaining it.
    let offset=0;
    try {
      while(offset<chunk.length) {
        const target=this.buffer.length<4?4:4+this.buffer.readUInt32LE(0);
        const count=Math.min(target-this.buffer.length,chunk.length-offset);
        this.buffer=Buffer.concat([this.buffer,chunk.subarray(offset,offset+count)]);offset+=count;
        if(this.buffer.length<4)continue;
        const size=this.buffer.readUInt32LE(0);
        if(size===0||size>MAX_FRAME)throw failure('BUILD_LIMIT');
        if(this.buffer.length===size+4) {
          const bytes=this.buffer.subarray(4);this.buffer=Buffer.alloc(0);
          let message;try{message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw failure('BUILD_PROTOCOL_ERROR');}
          this.onMessage(message);
        }
      }
    }catch(error){this.failed=true;this.buffer=Buffer.alloc(0);this.onError(error);}
  }
  end() { if(!this.failed&&this.buffer.length) {this.failed=true;this.onError(failure('BUILD_PROTOCOL_ERROR'));} }
}
module.exports={encode,Decoder};
