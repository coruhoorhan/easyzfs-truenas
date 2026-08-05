import os

def resolve_both(filepath):
    with open(filepath, 'r') as f:
        lines = f.readlines()
    
    out = []
    for line in lines:
        if line.startswith('<<<<<<<'):
            continue
        elif line.startswith('======='):
            continue
        elif line.startswith('>>>>>>>'):
            continue
        else:
            out.append(line)
            
    with open(filepath, 'w') as f:
        f.writelines(out)

resolve_both('internal/db/db.go')
resolve_both('internal/users/users.go')
resolve_both('web/src/components/icons.tsx')
