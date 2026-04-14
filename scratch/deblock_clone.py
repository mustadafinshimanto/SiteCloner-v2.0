import os
import re

directory = r'c:\Storage\Workspace\Antigravity\www.applegadgetsbd.com_clone'

def deblock_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Remove overflow-hidden from body
    content = re.sub(r'<body([^>]*)class="([^"]*)overflow-hidden([^"]*)"', r'<body\1class="\2\3"', content)
    # Also handle if it's just class="overflow-hidden"
    content = content.replace('class="overflow-hidden"', 'class=""')
    
    # 2. Inject a "Anti-Ad/Anti-Block" style at the end of head
    anti_block_style = """
    <style>
        /* Force scrolling and hide blocking overlays */
        body { 
            overflow: auto !important; 
            height: auto !important; 
            position: static !important;
        }
        [data-v7-id="v7-5qq3mhqbz"], 
        [data-v7-id="v7-qbke17nd5"],
        .fixed.inset-0.z-\\[100\\] { 
            display: none !important; 
            visibility: hidden !important; 
            pointer-events: none !important;
        }
        /* Surgical removal of the specific blocking div identified */
        div[class*="backdrop-blur"] {
            display: none !important;
        }
    </style>
    """
    if '</head>' in content:
        content = content.replace('</head>', anti_block_style + '</head>')

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

# Process all HTML files
for root, dirs, files in os.walk(directory):
    for file in files:
        if file.endswith('.html'):
            print(f"De-blocking: {file}")
            deblock_file(os.path.join(root, file))

print("De-blocking complete.")
