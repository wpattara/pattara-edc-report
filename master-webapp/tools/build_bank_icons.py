# -*- coding: utf-8 -*-
"""สร้าง BankIcons.js จากรูปโลโก้ธนาคารใน icons/<ชื่อแท็บ>.png (เช่น KBANK.png BBL.png KTB.png TTB.png KRUNGSRI.png)
ย่อเป็น 80x80 PNG (พื้นโปร่ง · ใส่พอดีกรอบไม่บิดสัดส่วน) → data URI → ตัวแปร BANK_ICONS ฝั่ง server
เก็บไว้ในไฟล์ .js ฝั่ง server (ไม่ใช่ใน HTML template) เพื่อเลี่ยงตัวตัดโค้ดของ HtmlService (errorLog E1)
ใช้: python -I tools/build_bank_icons.py   (รันจากโฟลเดอร์ master-webapp)
"""
import base64, io, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'icons')
OUT = os.path.join(ROOT, 'BankIcons.js')
SIZE = 80

if not os.path.isdir(SRC):
    sys.exit('ไม่พบโฟลเดอร์ ' + SRC + ' — สร้างแล้ววางรูป <ชื่อแท็บ>.png')

entries = []
for name in sorted(os.listdir(SRC)):
    base, ext = os.path.splitext(name)
    if ext.lower() not in ('.png', '.jpg', '.jpeg', '.webp'):
        continue
    key = base.strip().upper()
    im = Image.open(os.path.join(SRC, name)).convert('RGBA')
    # ตัดขอบโปร่งใส/ขาวล้วนรอบรูปออกก่อน ให้โลโก้เต็มกรอบ
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2), im)
    buf = io.BytesIO()
    canvas.save(buf, 'PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    entries.append((key, b64))
    print('%-10s %s → %d bytes' % (key, name, len(b64)))

if not entries:
    sys.exit('ไม่พบรูปใน ' + SRC)

lines = ['/** โลโก้ธนาคารบนชิป — สร้างโดย tools/build_bank_icons.py จาก icons/*.png (ห้ามแก้มือ ให้แก้รูปแล้วรันสคริปต์ใหม่)',
         ' *  คีย์ = ชื่อแท็บธนาคารในชีต MASTER · ค่า = data URI PNG %dx%d · ส่งให้หน้าเว็บผ่าน bootstrap (JSON escape / แล้ว) */' % (SIZE, SIZE),
         'var BANK_ICONS = {']
for i, (key, b64) in enumerate(entries):
    lines.append("  %s: 'data:image/png;base64,%s'%s" % (key, b64, ',' if i < len(entries) - 1 else ''))
lines.append('};')
with io.open(OUT, 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(lines) + '\n')
print('เขียน ' + OUT + ' (' + str(len(entries)) + ' ธนาคาร)')
