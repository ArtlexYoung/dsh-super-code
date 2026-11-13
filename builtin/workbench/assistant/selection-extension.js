import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, showTooltip } from '@codemirror/view';
import { mapThread, hasMark } from './selection-state.js';

export const refreshMarks = StateEffect.define();

class ConversationMark extends WidgetType {
  constructor(thread, open, t) { super(); this.id=thread.id; this.pinned=thread.pinned; this.open=open; this.t=t; }
  eq(other) { return other.id===this.id && other.pinned===this.pinned; }
  toDOM() {
    const wrapper=document.createElement('span'); wrapper.className='selection-mark';
    const button=document.createElement('button'); button.type='button'; button.textContent='◌';
    wrapper.classList.toggle('pinned',this.pinned);
    button.title=this.t('selection'); button.setAttribute('aria-label',button.title);
    button.onpointerdown=event=>event.preventDefault(); button.onclick=()=>this.open(this.id);
    wrapper.append(button); return wrapper;
  }
  ignoreEvent() { return true; }
}

export function selectionExtension(threads, open, select, t) {
  const decorations = (items, length) => Decoration.set(items.filter(hasMark).map(thread=>Decoration.widget({widget:new ConversationMark(thread,open,t),side:1}).range(Math.min(length,thread.to))),true);
  const marked = (items,length) => ({threads:items.map(thread=>({...thread})),decorations:decorations(items,length)});
  const marks=StateField.define({
    create:state=>marked(threads,state.doc.length),
    update(value,transaction) {
      let items=transaction.docChanged?value.threads.map(thread=>mapThread(thread,transaction.changes)):value.threads;
      for(const effect of transaction.effects) if(effect.is(refreshMarks)) items=effect.value;
      return items===value.threads?value:marked(items,transaction.state.doc.length);
    },
    provide:field=>EditorView.decorations.from(field,value=>value.decorations),
  });
  const selected=showTooltip.compute(['selection'],state=>{
    const range=state.selection.main;
    if(range.empty)return null;
    return {pos:range.to,above:true,arrow:false,create(){
      const dom=document.createElement('button'); dom.type='button'; dom.className='selection-action'; dom.textContent=t('selectionAction');
      dom.title=t('selectionAction'); dom.onpointerdown=event=>event.preventDefault(); dom.onclick=select;
      return {dom};
    }};
  });
  return [marks,selected];
}
