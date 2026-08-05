import re

with open('web/src/ui/i18n.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract the 'es' dictionary keys
es_match = re.search(r'const es = \{(.*?)\n\};\n\nexport type I18nKey = keyof typeof es;', content, re.DOTALL)
if not es_match:
    print("Could not find 'es' dictionary")
    exit(1)

es_dict_content = es_match.group(1)
es_keys = re.findall(r'^\s*([a-zA-Z0-9_]+):', es_dict_content, re.MULTILINE)

# Extract the 'tr' dictionary
tr_match = re.search(r'const tr: Record<I18nKey, string> = \{(.*?)\n\};', content, re.DOTALL)
if not tr_match:
    print("Could not find 'tr' dictionary")
    exit(1)

tr_dict_content = tr_match.group(1)
tr_keys = re.findall(r'^\s*([a-zA-Z0-9_]+):', tr_dict_content, re.MULTILINE)

missing_keys = set(es_keys) - set(tr_keys)
print(f"Missing keys in 'tr': {missing_keys}")

if missing_keys:
    # Add them to the end of the tr dictionary
    append_str = "\n  // Missing keys added automatically\n"
    for key in missing_keys:
        append_str += f"  {key}: 'TR_{key}',\n"
    
    new_tr_content = tr_dict_content + append_str
    
    new_content = content[:tr_match.start(1)] + new_tr_content + content[tr_match.end(1):]
    
    with open('web/src/ui/i18n.ts', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("i18n.ts updated successfully!")
