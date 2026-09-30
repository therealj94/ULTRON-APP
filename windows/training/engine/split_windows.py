"""Disjoint template-family split for the independent Windows model."""
import random

def split_families(rows, seed):
    by_label={}
    for row in rows:
        if not row.get('familyId'): raise ValueError('Every row needs familyId')
        label=tuple(sorted(row['e']))
        by_label.setdefault(label,{}).setdefault(row['familyId'],[]).append(row)
    train=[]; validation=[]
    for label,groups in sorted(by_label.items()):
        keys=sorted(groups)
        if len(keys)<2: raise ValueError(f'Need at least two families for {label}')
        random.Random(seed).shuffle(keys)
        held=set(keys[:max(1,len(keys)//5)])
        for key,items in groups.items(): (validation if key in held else train).extend(items)
    assert not {r['familyId'] for r in train}&{r['familyId'] for r in validation}
    return validation,train
