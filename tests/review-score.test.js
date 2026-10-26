'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../extension/feed-core.js');
const API=require('../extension/api-provider.js');
const answer=data=>'Findings with evidence.\n<SUPERX_REVIEW>'+JSON.stringify(data)+'</SUPERX_REVIEW>';
const scored=(score,extra={})=>({score,status:'scored',confidence:'high',reason:'Primary evidence contradicts the claim.',...extra});

test('review score uses five ordered bands and keeps metadata out of the answer',()=>{
  for(const [score,band] of [[0,0],[20,0],[21,1],[40,1],[41,2],[60,2],[61,3],[80,3],[81,4],[100,4]]){
    const value=Core.reviewScore(answer(scored(score)));assert.equal(value.score,score);assert.equal(value.band,band);assert.equal(value.text,'Findings with evidence.');
  }
});
test('missing evidence, low confidence and subjective material do not become invented numbers',()=>{
  for(const status of ['insufficient','not_applicable'])assert.equal(Core.reviewScore(answer(scored(90,{status}))).score,null);
  assert.equal(Core.reviewScore(answer(scored(90,{confidence:'low'}))).status,'insufficient');
  for(const score of [-1,101,2.5,'80'])assert.equal(Core.reviewScore(answer(scored(score))).score,null);
  assert.equal(Core.reviewScore('An older answer without scoring.').status,'missing');
});
test('partial, malformed and oversized score metadata never leaks into rendered prose',()=>{
  for(const tail of ['<SUPERX_','<SUPERX_REVIEW>{"score":','<SUPERX_REVIEW>{bad}</SUPERX_REVIEW>','<SUPERX_REVIEW>'+ 'x'.repeat(900)+'</SUPERX_REVIEW>']){
    const parsed=Core.reviewScore('Findings.\n'+tail);assert.equal(parsed.text,'Findings.');assert.equal(parsed.score,null);
  }
});
test('one post request carries the score rubric; comments do not receive it',()=>{
  const post={id:'123',url:'https://x.com/author/status/123',text:'A factual claim',images:[]};
  const request=API.buildRequest(post,{...Core.DEFAULT_SETTINGS,provider:'api'},'verify');
  assert.ok(request.instructions.includes(Core.REVIEW_SCORE_RULES));assert.equal(request.stream,true);
  assert.ok(!API.buildRequest(post,{...Core.DEFAULT_SETTINGS,provider:'api'},'comments').instructions.includes(Core.REVIEW_SCORE_RULES));
});
