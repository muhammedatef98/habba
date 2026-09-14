#!/usr/bin/env python3
"""Emit the .dc.html artboards for the ownership-transfer canvas.

One source per screen, rendered twice — light and dark — from the real
packages/ui tokens, so the two themes cannot drift apart the way two
hand-written copies would.
"""

import json
import os

W, H = 390, 844

LIGHT = dict(
    bg="#F6F3ED", surface="#FFFFFF", raised="#FFFFFF", sunken="#F0EBE1",
    border="#E2DDD2", borderStrong="#CFD6D4",
    text="#14201F", muted="#4A5654", subtle="#66706E", inverse="#FFFFFF",
    primary="#12514F", primarySubtle="#EFF7F6", primaryText="#FFFFFF",
    accent="#E8A33D", accentSubtle="#FBEDD6", accentFg="#8A5A16",
    emergency="#C4342A", emergencyFg="#9E2820", emergencySubtle="#FDF3F2",
    emergencyBorder="#F0D3D0",
    success="#1F8A5B", successFg="#15613F", successSubtle="#E9F6F0",
    successBorder="#BFE3D2",
    warningFg="#8A5A16", warningSubtle="#FBEDD6", warningBorder="#EBD5A8",
    verified="#12514F", verifiedSubtle="#EFF7F6",
    selfDocumented="#8A5A16", selfDocumentedSubtle="#FBEDD6",
    selfReported="#4A5654", selfReportedSubtle="#F0EBE1",
    overlay="rgba(20, 32, 31, 0.55)",
)

DARK = dict(
    bg="#071A1A", surface="#0F2A29", raised="#123634", sunken="#0A2322",
    border="#204442", borderStrong="#2C5250",
    text="#EFF3F1", muted="#8AA3A0", subtle="#6E8785", inverse="#04211F",
    primary="#34968F", primarySubtle="#0B2E2E", primaryText="#04211F",
    accent="#F0BC72", accentSubtle="#2A1F10", accentFg="#F0BC72",
    emergency="#E06B60", emergencyFg="#E06B60", emergencySubtle="#2A1513",
    emergencyBorder="#5A2A26",
    success="#5FC493", successFg="#5FC493", successSubtle="#0C2A1E",
    successBorder="#1F5340",
    warningFg="#F0BC72", warningSubtle="#2A1F10", warningBorder="#5A4320",
    verified="#34968F", verifiedSubtle="#0B2E2E",
    selfDocumented="#F0BC72", selfDocumentedSubtle="#2A1F10",
    selfReported="#8AA3A0", selfReportedSubtle="#0A2322",
    overlay="rgba(4, 17, 17, 0.66)",
)

# SINGLE quotes inside the family list, deliberately. These strings are
# interpolated into double-quoted style="..." attributes, and a double quote
# there closes the attribute early — silently dropping every declaration that
# follows, `display: flex` included. That is not hypothetical: it flattened
# every screen in this canvas until it was caught by measuring the DOM.
FONT = "'IBM Plex Sans Arabic', 'Tajawal', system-ui, sans-serif"
LATIN = "'Outfit', 'IBM Plex Sans Arabic', system-ui, sans-serif"


def shell(t, body, scroll=False):
    """The phone frame every artboard sits in. No fake status bar (skill rule).

    Deliberately NOT `overflow: hidden`. A mockup that clips is a mockup that
    lies about whether the screen fits, and this one did: a row that layout
    placed inside the frame was being painted away.
    """
    return f"""<div dir="rtl" style="width: {W}px; min-height: {H}px; background: {t['bg']};
     color: {t['text']}; font-family: {FONT}; line-height: 1.7; font-size: 16px;
     display: flex; flex-direction: column;">
{body}
</div>"""


def appbar(t, title, back=True):
    chevron = f"""<svg width="24" height="24" viewBox="0 0 24 24" fill="none"
       stroke="{t['text']}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
       style="flex: none;"><path d="m9 18 6-6-6-6"></path></svg>""" if back else ""
    return f"""  <div style="display: flex; align-items: center; gap: 12px; padding: 16px;
       border-bottom: 1px solid {t['border']}; background: {t['surface']}; flex: none;">
    {chevron}
    <div style="font-size: 20px; font-weight: 600;">{title}</div>
  </div>"""


def primary_btn(t, label, muted=False):
    bg = t["sunken"] if muted else t["primary"]
    fg = t["subtle"] if muted else t["primaryText"]
    return f"""<div style="min-height: 56px; border-radius: 16px; background: {bg};
     color: {fg}; display: flex; align-items: center; justify-content: center;
     font-size: 16px; font-weight: 600;">{label}</div>"""


def secondary_btn(t, label, tone=None):
    colour = tone or t["primary"]
    return f"""<div style="min-height: 48px; border-radius: 16px; border: 1.5px solid {colour};
     color: {colour}; display: flex; align-items: center; justify-content: center;
     font-size: 16px; font-weight: 600;">{label}</div>"""


def card(t, inner, pad=16, bg=None, border=None):
    return f"""<div style="background: {bg or t['surface']}; border: 1px solid {border or t['border']};
     border-radius: 16px; padding: {pad}px;">{inner}</div>"""


def car_strip(t):
    """The car being transferred, shown identically wherever it appears."""
    return f"""<div style="display: flex; align-items: center; gap: 12px;">
      <div style="width: 44px; height: 44px; border-radius: 12px; background: {t['primarySubtle']};
           display: flex; align-items: center; justify-content: center; flex: none;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="{t['primary']}"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13"></path>
          <path d="M4 13h16v4H4z"></path><circle cx="7.5" cy="17.5" r="1.5"></circle>
          <circle cx="16.5" cy="17.5" r="1.5"></circle></svg>
      </div>
      <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
        <div style="font-size: 16px; font-weight: 600;">تويوتا كامري 2019</div>
        <div style="font-size: 13px; color: {t['subtle']};"><bdi>أ ب ج 1234</bdi> · <bdi>61,200</bdi> كم</div>
      </div>
    </div>"""


# ---------------------------------------------------------------------------
# 1 — where «نقل الملكية» sits in the logbook
# ---------------------------------------------------------------------------
def screen_entry(t):
    return shell(t, f"""{appbar(t, 'دفتر السيارة')}
  <div style="flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 16px;">

    {card(t, f'''
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="font-size: 20px; font-weight: 500;">ما الذي تضمنه هبّة</div>
        <div style="display: flex; align-items: baseline; gap: 8px;">
          <div style="font-family: {LATIN}; font-size: 32px; font-weight: 600; color: {t['primary']}; line-height: 1;"><bdi>38%</bdi></div>
          <div style="font-size: 14px; color: {t['muted']};">من السجلات موثّقة من هبّة</div>
        </div>
        <div style="display: flex; gap: 2px; height: 10px;">
          <div style="width: 38%; background: {t['verified']};"></div>
          <div style="width: 25%; background: {t['selfDocumented']};"></div>
          <div style="width: 37%; background: {t['borderStrong']};"></div>
        </div>
        {primary_btn(t, 'أصدر تقرير هبّة (PDF)')}
      </div>''')}

    <div style="display: flex; flex-direction: column; gap: 10px; opacity: .55;">
      <div style="font-size: 14px; font-weight: 600; color: {t['muted']};">٢٠٢٦</div>
      <div style="height: 1px; background: {t['border']};"></div>
      <div style="height: 52px; background: {t['surface']}; border: 1px solid {t['border']}; border-radius: 16px;"></div>
    </div>

    <div style="flex: 1;"></div>

    <!-- The destructive action lives at the FOOT of the screen, in its own
         section, deliberately far from «أصدر تقرير» — which is the button
         people press often, and the one it would be worst to mis-tap. -->
    <div style="display: flex; flex-direction: column; gap: 10px;">
      <div style="font-size: 12px; font-weight: 600; color: {t['subtle']}; letter-spacing: .3px;">إدارة السيارة</div>
      <div style="background: {t['surface']}; border: 1px solid {t['border']}; border-radius: 16px; overflow: hidden;">
        <div style="display: flex; align-items: center; gap: 12px; padding: 14px 16px; min-height: 48px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="{t['muted']}" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle>
            <path d="M12 7v5l3 2"></path></svg>
          <div style="flex: 1; font-size: 16px;">تحديث قراءة العدّاد</div>
        </div>
        <div style="height: 1px; background: {t['border']};"></div>
        <div style="display: flex; align-items: center; gap: 12px; padding: 14px 16px; min-height: 48px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="{t['accentFg']}" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"></path>
            <path d="M21 3l-7 7"></path><path d="M8 21H3v-5"></path><path d="M3 21l7-7"></path></svg>
          <div style="flex: 1; display: flex; flex-direction: column; gap: 1px;">
            <div style="font-size: 16px; color: {t['accentFg']};">نقل الملكية</div>
            <div style="font-size: 12px; color: {t['subtle']};">ينتقل الدفتر مع السيارة</div>
          </div>
        </div>
      </div>
    </div>
  </div>""")


# ---------------------------------------------------------------------------
# 2 — the warning: the logbook goes with the car
# ---------------------------------------------------------------------------
def screen_warn(t):
    def row(icon_colour, glyph, title, body):
        return f"""<div style="display: flex; gap: 10px; align-items: flex-start;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="{icon_colour}"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
               style="flex: none; margin-top: 5px;">{glyph}</svg>
          <div style="display: flex; flex-direction: column; gap: 1px;">
            <div style="font-size: 15px; font-weight: 600;">{title}</div>
            <div style="font-size: 13px; color: {t['muted']}; line-height: 1.6;">{body}</div>
          </div>
        </div>"""

    gone = '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>'
    kept = '<path d="M20 6 9 17l-5-5"></path>'
    warn = '<path d="M12 9v4"></path><path d="M12 17h.01"></path><circle cx="12" cy="12" r="9"></circle>'

    return shell(t, f"""  <div style="flex: 1; background: {t['overlay']};"></div>
  <div style="background: {t['surface']}; border-top-left-radius: 24px; border-top-right-radius: 24px;
       padding: 8px 16px 20px; display: flex; flex-direction: column; gap: 16px; flex: none;">
    <div style="width: 40px; height: 4px; border-radius: 999px; background: {t['border']}; align-self: center;"></div>

    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="font-size: 24px; font-weight: 600;">نقل ملكية السيارة</div>
      <div style="font-size: 14px; color: {t['muted']};">اقرأ هذا قبل المتابعة — لا يمكن التراجع بعد قبول المشتري.</div>
    </div>

    {card(t, car_strip(t), bg=t['sunken'], border=t['border'])}

    <div style="display: flex; flex-direction: column; gap: 12px;">
      {row(t['emergencyFg'], gone, 'دفتر السيارة ينتقل بالكامل',
           'كل السجلات والصور والفحوصات تصبح للمالك الجديد. هذا هو المقصود: قيمة السيارة في دفترها.')}
      {row(t['emergencyFg'], gone, 'تفقد الوصول إلى السجل',
           'تختفي السيارة من قائمتك، ولن تفتح دفترها ولا تقارير هبّة التي أصدرتها لها.')}
      {row(t['successFg'], kept, 'تحتفظ بحسابك وسياراتك الأخرى',
           'وبأي ملف PDF حفظته قبل النقل — الملف عندك، لا في السجل.')}
      {row(t['warningFg'], warn, 'الضمان لا ينتقل',
           'الضمان على أعمال دفعت أنت ثمنها يبقى باسمك. المشتري يرى الضمان في التقرير ولا يستطيع المطالبة به.')}
    </div>

    <!-- Offered HERE and not on the confirmation screen: after the transfer is
         accepted the seller can no longer generate one. -->
    <div style="display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 16px;
         background: {t['primarySubtle']}; border: 1px solid {t['primary']};">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="{t['primary']}" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" style="flex: none;">
        <path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
      <div style="flex: 1; font-size: 13.5px; color: {t['text']}; line-height: 1.55;">
        احفظ نسخة PDF الآن — بعد النقل لن تستطيع إصدارها.
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 10px;">
      {primary_btn(t, 'متابعة')}
      {secondary_btn(t, 'إلغاء')}
    </div>
  </div>""")


# ---------------------------------------------------------------------------
# 3 — addressing by phone or email
# ---------------------------------------------------------------------------
def screen_address(t):
    return shell(t, f"""{appbar(t, 'إلى مَن تنقلها؟')}
  <div style="flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 16px;">

    <div style="display: flex; background: {t['sunken']}; border-radius: 16px; padding: 4px; gap: 4px;">
      <div style="flex: 1; min-height: 44px; border-radius: 12px; background: {t['surface']};
           border: 1px solid {t['border']}; display: flex; align-items: center; justify-content: center;
           font-size: 15px; font-weight: 600;">رقم الجوال</div>
      <div style="flex: 1; min-height: 44px; border-radius: 12px; display: flex; align-items: center;
           justify-content: center; font-size: 15px; color: {t['subtle']};">البريد الإلكتروني</div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="font-size: 14px; font-weight: 600;">رقم جوال المشتري</div>
      <div style="min-height: 56px; border-radius: 16px; border: 1.5px solid {t['primary']};
           background: {t['surface']}; display: flex; align-items: center; padding: 0 16px;">
        <div style="font-family: {LATIN}; font-size: 18px; letter-spacing: .5px;" dir="ltr"><bdi>+966 55 123 4567</bdi></div>
      </div>
    </div>

    <!-- Discovery requires a VERIFIED identity (0045). Saying so here is the
         difference between a transfer that lands and one that vanishes. -->
    <div style="display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 16px;
         background: {t['warningSubtle']}; border: 1px solid {t['warningBorder']};">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="{t['warningFg']}" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" style="flex: none; margin-top: 3px;">
        <circle cx="12" cy="12" r="9"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path></svg>
      <div style="font-size: 13px; color: {t['text']}; line-height: 1.6;">
        يجب أن يكون المشتري قد سجّل في هبّة بهذا الرقم وأكّده. لا يمكن نقل السيارة إلى رقم لم يُفعّل بعد.
      </div>
    </div>

    <div style="height: 1px; background: {t['border']};"></div>

    <div style="display: flex; flex-direction: column; gap: 10px;">
      <div style="font-size: 12px; font-weight: 600; color: {t['subtle']};">قبل التأكيد</div>
      {card(t, f'''
        <div style="display: flex; flex-direction: column; gap: 12px;">
          {car_strip(t)}
          <div style="height: 1px; background: {t['border']};"></div>
          <div style="display: flex; justify-content: space-between; font-size: 14px;">
            <span style="color: {t['muted']};">ينتقل الدفتر</span>
            <span style="font-weight: 600;"><bdi>8</bdi> سجلات · منذ <bdi>2023</bdi></span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 14px;">
            <span style="color: {t['muted']};">إلى</span>
            <span style="font-weight: 600; font-family: {LATIN};"><bdi>+966 55 123 4567</bdi></span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 14px;">
            <span style="color: {t['muted']};">تنتهي صلاحية الطلب</span>
            <span style="font-weight: 600;">بعد <bdi>7</bdi> أيام</span>
          </div>
        </div>''', bg=t['sunken'])}
    </div>

    <div style="flex: 1;"></div>
    {primary_btn(t, 'أنشئ رمز التسليم')}
  </div>""")


# ---------------------------------------------------------------------------
# 4 — the handover code, shown once
# ---------------------------------------------------------------------------
def screen_code(t):
    digits = "".join(
        f"""<div style="flex: 1; aspect-ratio: 1; border-radius: 10px; background: {t['surface']};
         border: 1.5px solid {t['primary']}; display: flex; align-items: center; justify-content: center;
         font-family: {LATIN}; font-size: 24px; font-weight: 600;">{d}</div>"""
        for d in "471".ljust(1) and ["4", "7", "1", "9", "0", "6"]
    )
    return shell(t, f"""{appbar(t, 'رمز التسليم', back=False)}
  <div style="flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 20px;">

    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="font-size: 24px; font-weight: 600;">اقرأ هذا الرمز للمشتري</div>
      <div style="font-size: 14px; color: {t['muted']}; line-height: 1.6;">
        يكتبه في تطبيقه لإتمام النقل. الرمز وحده لا يكفي — لا يقبله إلا من يملك الرقم الذي أرسلت إليه.
      </div>
    </div>

    <div style="display: flex; gap: 8px;" dir="ltr">{digits}</div>

    <div style="display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 16px;
         background: {t['emergencySubtle']}; border: 1px solid {t['emergencyBorder']};">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="{t['emergencyFg']}" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" style="flex: none; margin-top: 3px;">
        <path d="M12 9v4"></path><path d="M12 17h.01"></path><circle cx="12" cy="12" r="9"></circle></svg>
      <div style="font-size: 13px; color: {t['text']}; line-height: 1.6;">
        يظهر هذا الرمز مرة واحدة. هبّة لا تحتفظ به، ولا يمكن استعادته — إن فقدته، ألغِ الطلب وأنشئ واحداً جديداً.
      </div>
    </div>

    {card(t, f'''
      <div style="display: flex; flex-direction: column; gap: 10px;">
        {car_strip(t)}
        <div style="height: 1px; background: {t['border']};"></div>
        <div style="display: flex; justify-content: space-between; font-size: 14px;">
          <span style="color: {t['muted']};">أُرسل إلى</span>
          <span style="font-weight: 600; font-family: {LATIN};"><bdi>+966 55 123 4567</bdi></span>
        </div>
      </div>''', bg=t['sunken'])}

    <div style="flex: 1;"></div>
    {primary_btn(t, 'تم — عرضته للمشتري')}
  </div>""")


# ---------------------------------------------------------------------------
# 5 — the seller waiting
# ---------------------------------------------------------------------------
def screen_pending(t):
    return shell(t, f"""{appbar(t, 'سياراتي')}
  <div style="flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 12px;">

    <div style="background: {t['surface']}; border: 1px solid {t['warningBorder']}; border-radius: 16px;
         padding: 16px; display: flex; flex-direction: column; gap: 12px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        {car_strip(t)}
        <div style="font-size: 11px; font-weight: 600; color: {t['warningFg']}; background: {t['warningSubtle']};
             border: 1px solid {t['warningBorder']}; border-radius: 999px; padding: 3px 10px; flex: none;">
          بانتظار القبول
        </div>
      </div>
      <div style="height: 1px; background: {t['border']};"></div>
      <div style="font-size: 13.5px; color: {t['muted']}; line-height: 1.6;">
        أُرسلت إلى <bdi style="font-family: {LATIN}; color: {t['text']};">+966 55 123 4567</bdi>.
        السيارة ما زالت لك حتى يكتب المشتري الرمز.
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 13px;">
        <span style="color: {t['subtle']};">تنتهي الصلاحية</span>
        <span style="font-weight: 600;">بعد <bdi>6</bdi> أيام</span>
      </div>
      {secondary_btn(t, 'إلغاء النقل', tone=t['emergencyFg'])}
    </div>

    <div style="background: {t['surface']}; border: 1px solid {t['border']}; border-radius: 16px; padding: 16px;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="width: 44px; height: 44px; border-radius: 12px; background: {t['sunken']};
             display: flex; align-items: center; justify-content: center; flex: none;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="{t['subtle']}"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13"></path>
            <path d="M4 13h16v4H4z"></path><circle cx="7.5" cy="17.5" r="1.5"></circle>
            <circle cx="16.5" cy="17.5" r="1.5"></circle></svg>
        </div>
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="font-size: 16px; font-weight: 600;">هيونداي إلنترا 2022</div>
          <div style="font-size: 13px; color: {t['subtle']};"><bdi>د ه و 5678</bdi></div>
        </div>
      </div>
    </div>
    <div style="flex: 1;"></div>
  </div>""")


# ---------------------------------------------------------------------------
# 6 — recipient who already has an account
# ---------------------------------------------------------------------------
def screen_accept(t):
    boxes = "".join(
        f"""<div style="flex: 1; aspect-ratio: 1; border-radius: 10px; background: {t['surface']};
         border: 1.5px solid {t['border'] if i > 2 else t['primary']}; display: flex; align-items: center;
         justify-content: center; font-family: {LATIN}; font-size: 24px; font-weight: 600;
         color: {t['text']};">{'471'[i] if i < 3 else ''}</div>"""
        for i in range(6)
    )
    return shell(t, f"""{appbar(t, 'سيارة بانتظارك')}
  <div style="flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 16px;">

    {card(t, f'''
      <div style="display: flex; flex-direction: column; gap: 14px;">
        {car_strip(t)}
        <div style="height: 1px; background: {t['border']};"></div>
        <div style="font-size: 13.5px; color: {t['muted']}; line-height: 1.6;">
          يريد المالك الحالي نقل هذه السيارة إليك، ومعها دفترها كاملاً.
        </div>
        <div style="display: flex; gap: 8px;">
          <div style="flex: 1; background: {t['sunken']}; border-radius: 12px; padding: 10px; text-align: center;">
            <div style="font-family: {LATIN}; font-size: 20px; font-weight: 600;"><bdi>8</bdi></div>
            <div style="font-size: 11.5px; color: {t['subtle']};">سجل</div>
          </div>
          <div style="flex: 1; background: {t['verifiedSubtle']}; border-radius: 12px; padding: 10px; text-align: center;">
            <div style="font-family: {LATIN}; font-size: 20px; font-weight: 600; color: {t['verified']};"><bdi>3</bdi></div>
            <div style="font-size: 11.5px; color: {t['subtle']};">موثّقة من هبّة</div>
          </div>
          <div style="flex: 1; background: {t['sunken']}; border-radius: 12px; padding: 10px; text-align: center;">
            <div style="font-family: {LATIN}; font-size: 20px; font-weight: 600;"><bdi>2023</bdi></div>
            <div style="font-size: 11.5px; color: {t['subtle']};">منذ</div>
          </div>
        </div>
      </div>''')}

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div style="font-size: 14px; font-weight: 600;">اكتب رمز التسليم</div>
      <div style="font-size: 13px; color: {t['muted']};">الرمز الذي قرأه لك البائع.</div>
      <div style="display: flex; gap: 8px; margin-top: 4px;" dir="ltr">{boxes}</div>
    </div>

    <div style="flex: 1;"></div>
    <div style="display: flex; flex-direction: column; gap: 10px;">
      {primary_btn(t, 'استلام السيارة', muted=True)}
      <div style="font-size: 12px; color: {t['subtle']}; text-align: center; line-height: 1.6;">
        باستلامها تصبح السيارة ودفترها لك، وتختفي من حساب البائع.
      </div>
    </div>
  </div>""")


# ---------------------------------------------------------------------------
# 7 — recipient with no Habba account: the acquisition moment
# ---------------------------------------------------------------------------
def screen_welcome(t):
    return shell(t, f"""  <div style="flex: 1; padding: 24px 16px 16px; display: flex; flex-direction: column; gap: 20px;">

    <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center;">
      <div style="width: 56px; height: 56px; border-radius: 18px; background: {t['primary']};
           display: flex; align-items: center; justify-content: center;">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="{t['primaryText']}"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13"></path>
          <path d="M4 13h16v4H4z"></path><circle cx="7.5" cy="17.5" r="1.5"></circle>
          <circle cx="16.5" cy="17.5" r="1.5"></circle></svg>
      </div>
      <div style="font-size: 24px; font-weight: 600; line-height: 1.4;">تويوتا كامري بانتظارك</div>
      <div style="font-size: 14.5px; color: {t['muted']}; line-height: 1.7; text-wrap: pretty;">
        البائع أرسل لك السيارة على هذا الرقم. أنشأنا حسابك — وهذا ما يأتي معها.
      </div>
    </div>

    <!-- The point of the screen: show the logbook's WEIGHT before asking for
         anything. This is the moment a stranger becomes a Habba account. -->
    {card(t, f'''
      <div style="display: flex; flex-direction: column; gap: 14px;">
        <div style="font-size: 15px; font-weight: 600;">دفتر السيارة الذي ستستلمه</div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 8px; height: 8px; border-radius: 999px; background: {t['verified']}; flex: none;"></div>
            <div style="flex: 1; font-size: 14px;"><bdi>3</bdi> سجلات نفّذها فنّي هبّة بصور وقراءة عدّاد</div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 8px; height: 8px; border-radius: 999px; background: {t['selfDocumented']}; flex: none;"></div>
            <div style="flex: 1; font-size: 14px;"><bdi>2</bdi> سجلان بفواتير مرفقة من المالك</div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 8px; height: 8px; border-radius: 999px; background: {t['selfReported']}; flex: none;"></div>
            <div style="flex: 1; font-size: 14px;"><bdi>3</bdi> سجلات مُدخلة من المالك</div>
          </div>
        </div>
        <div style="height: 1px; background: {t['border']};"></div>
        <div style="font-size: 13px; color: {t['muted']}; line-height: 1.6;">
          تاريخ يعود إلى <bdi>2023</bdi>، وسلسلة تحقّق تثبت أن أي سجل لم يُعدَّل بعد تدوينه.
        </div>
      </div>''')}

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div style="font-size: 14px; font-weight: 600;">اكتب رمز التسليم من البائع</div>
      <div style="display: flex; gap: 8px;" dir="ltr">
        {"".join(f'''<div style="flex: 1; aspect-ratio: 1; border-radius: 10px; background: {t['surface']};
          border: 1.5px solid {t['border']};"></div>''' for _ in range(6))}
      </div>
    </div>

    <div style="flex: 1;"></div>
    <div style="display: flex; flex-direction: column; gap: 10px;">
      {primary_btn(t, 'استلام السيارة', muted=True)}
      <div style="font-size: 12px; color: {t['subtle']}; text-align: center;">
        ليس معك رمز؟ اطلبه من البائع — يظهر له في التطبيق.
      </div>
    </div>
  </div>""")


# ---------------------------------------------------------------------------
# 8 — the seller afterwards
# ---------------------------------------------------------------------------
def screen_after(t):
    def line(colour, glyph, text):
        return f"""<div style="display: flex; gap: 10px; align-items: flex-start;">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="{colour}" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round" style="flex: none; margin-top: 4px;">{glyph}</svg>
          <div style="flex: 1; font-size: 14px; line-height: 1.6;">{text}</div>
        </div>"""
    gone = '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>'
    kept = '<path d="M20 6 9 17l-5-5"></path>'

    return shell(t, f"""  <div style="flex: 1; padding: 24px 16px 16px; display: flex; flex-direction: column; gap: 20px;">
    <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center;">
      <div style="width: 56px; height: 56px; border-radius: 999px; background: {t['successSubtle']};
           border: 1px solid {t['successBorder']}; display: flex; align-items: center; justify-content: center;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="{t['successFg']}" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
      </div>
      <div style="font-size: 24px; font-weight: 600;">تم نقل الملكية</div>
      <div style="font-size: 14.5px; color: {t['muted']}; line-height: 1.7;">
        تويوتا كامري 2019 أصبحت للمالك الجديد، ومعها دفترها.
      </div>
    </div>

    {card(t, f'''
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="font-size: 12px; font-weight: 600; color: {t['subtle']};">ما الذي تغيّر</div>
        {line(t['emergencyFg'], gone, 'خرجت السيارة من قائمتك، ولم يعد بإمكانك فتح دفترها.')}
        {line(t['emergencyFg'], gone, 'تقارير هبّة التي أصدرتها لهذه السيارة لم تعد متاحة من التطبيق.')}
        {line(t['successFg'], kept, 'حسابك وسياراتك الأخرى كما هي.')}
        {line(t['successFg'], kept, 'أي ملف PDF حفظته يبقى عندك على جهازك.')}
      </div>''')}

    <div style="display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 16px;
         background: {t['warningSubtle']}; border: 1px solid {t['warningBorder']};">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="{t['warningFg']}" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" style="flex: none; margin-top: 3px;">
        <circle cx="12" cy="12" r="9"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path></svg>
      <div style="font-size: 13px; line-height: 1.6;">
        الضمان على الأعمال التي دفعت ثمنها ما زال باسمك. إن احتجت مطالبة، تواصل مع الدعم.
      </div>
    </div>

    <div style="flex: 1;"></div>
    {primary_btn(t, 'العودة إلى سياراتي')}
  </div>""")


# ---------------------------------------------------------------------------
# 9 — logbook grouped by year (the parked mock)
# ---------------------------------------------------------------------------
def screen_years(t):
    def event(title, meta, provenance):
        colour = {"v": t["verified"], "d": t["selfDocumented"], "s": t["selfReported"]}[provenance]
        label = {"v": "موثّق من هبّة", "d": "مُدخل مع مرفق", "s": "مُدخل من المالك"}[provenance]
        chip_bg = {"v": t["verifiedSubtle"], "d": t["selfDocumentedSubtle"], "s": t["selfReportedSubtle"]}[provenance]
        return f"""<div style="display: flex; gap: 12px;">
          <div style="width: 20px; display: flex; flex-direction: column; align-items: center; flex: none;">
            <div style="width: 10px; height: 10px; border-radius: 999px; background: {colour}; margin-top: 6px;"></div>
            <div style="flex: 1; width: 2px; background: {t['border']};"></div>
          </div>
          <div style="flex: 1; padding-bottom: 14px; display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <div style="font-size: 15px; font-weight: 600;">{title}</div>
              <div style="font-size: 11px; color: {colour}; background: {chip_bg}; border-radius: 999px;
                   padding: 2px 9px;">{label}</div>
            </div>
            <div style="font-size: 12.5px; color: {t['subtle']};">{meta}</div>
          </div>
        </div>"""

    def month(name, rows):
        return f"""<div style="display: flex; flex-direction: column; gap: 0;">
          <div style="font-size: 12px; font-weight: 600; color: {t['subtle']}; padding: 2px 0 8px 0;">{name}</div>
          {rows}
        </div>"""

    def year(label, summary, months, first=False):
        return f"""<div style="display: flex; flex-direction: column; gap: 10px; margin-top: {0 if first else 12}px;">
          <div style="display: flex; align-items: baseline; gap: 10px; background: {t['sunken']};
               border: 1px solid {t['border']}; border-radius: 12px; padding: 8px 12px;">
            <div style="font-family: {LATIN}; font-size: 20px; font-weight: 600;"><bdi>{label}</bdi></div>
            <div style="font-size: 12.5px; color: {t['muted']};">{summary}</div>
          </div>
          {months}
        </div>"""

    return shell(t, f"""{appbar(t, 'دفتر السيارة')}
  <div style="flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 12px;">

    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
      <div style="min-height: 36px; border-radius: 999px; padding: 6px 14px; background: {t['primarySubtle']};
           border: 1.5px solid {t['primary']}; color: {t['primary']}; font-size: 12.5px;
           display: flex; align-items: center;">الكل · <bdi>8</bdi></div>
      <div style="min-height: 36px; border-radius: 999px; padding: 6px 14px; background: {t['sunken']};
           border: 1px solid {t['border']}; color: {t['muted']}; font-size: 12.5px;
           display: flex; align-items: center;">صيانة · <bdi>5</bdi></div>
      <div style="min-height: 36px; border-radius: 999px; padding: 6px 14px; background: {t['sunken']};
           border: 1px solid {t['border']}; color: {t['muted']}; font-size: 12.5px;
           display: flex; align-items: center;">فحص · <bdi>1</bdi></div>
    </div>

    <div style="display: flex; flex-direction: column;">
      {year('2026', 'سجلان · 1 موثّق من هبّة',
            month('يناير',
                  event('تغيير زيت وفلتر', '<bdi>61,200</bdi> كم · <bdi>3</bdi> صور', 'v')
                  + event('تبديل إطارات', '<bdi>60,500</bdi> كم · مرفق واحد', 'd')),
            first=True)}
      {year('2025', '3 سجلات · 2 موثّقة من هبّة',
            month('أغسطس', event('تغيير فحمات أمامية', '<bdi>54,800</bdi> كم · <bdi>4</bdi> صور', 'v'))
            + month('مايو', event('فحص دوري شامل', '<bdi>51,100</bdi> كم · نتيجة <bdi>84</bdi>', 'v')))}
      {year('2024', 'سجل واحد · لا شيء موثّق من هبّة',
            month('فبراير', event('تغيير بطارية', '<bdi>43,900</bdi> كم · سُجّل لاحقاً', 's')))}
    </div>
  </div>""")


SCREENS = [
    ("Main", screen_entry, "دفتر السيارة — مدخل نقل الملكية"),
    ("Warning", screen_warn, "التحذير — الدفتر ينتقل مع السيارة"),
    ("Address", screen_address, "العنونة — جوال أو بريد"),
    ("Code", screen_code, "رمز التسليم"),
    ("Pending", screen_pending, "البائع بانتظار القبول"),
    ("Accept", screen_accept, "المشتري ولديه حساب"),
    ("Welcome", screen_welcome, "المشتري بلا حساب"),
    ("Handover", screen_after, "بعد النقل — البائع"),
    ("Years", screen_years, "الدفتر مُجمّعاً بالسنة"),
]

TEMPLATE = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Outfit:wght@400;500;600&display=swap">
  <style>
    body {{ margin: 0; background: {page}; }}
    * {{ box-sizing: border-box; }}
    a {{ color: {link}; }} a:hover {{ color: {linkHover}; }}
  </style>
</helmet>
{body}
</x-dc>
</body>
</html>
"""


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    artboards = []
    gap_x, gap_y = 110, 180

    for theme_name, t, row in (("", LIGHT, 0), ("Dark", DARK, 1)):
        for i, (stem, fn, title) in enumerate(SCREENS):
            name = f"{stem}{theme_name}"
            path = os.path.join(here, f"{name}.dc.html")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(TEMPLATE.format(
                    page=t["bg"],
                    link=t["primary"],
                    linkHover=t["text"],
                    body=fn(t),
                ))
            artboards.append({
                "file": f"{name}.dc.html",
                "x": i * (W + gap_x),
                "y": row * (H + gap_y),
                "w": W, "h": H,
                "title": f"{title} — {'داكن' if theme_name else 'فاتح'}",
            })

    canvas = {
        "artboards": artboards,
        "annotations": [
            {"id": "flow", "x": 0, "y": -150, "w": 900,
             "text": "نقل الملكية — الصف العلوي فاتح، السفلي داكن.\n"
                     "١ المدخل · ٢ التحذير · ٣ العنونة · ٤ الرمز · ٥ الانتظار · "
                     "٦ القبول (بحساب) · ٧ القبول (بلا حساب) · ٨ بعد النقل · ٩ التجميع بالسنة"},
            {"id": "gap-rpc", "x": 940, "y": -150, "w": 620,
             "text": "لا توجد دالة initiate_ownership_transfer في قاعدة البيانات بعد.\n"
                     "الإنشاء اليوم إدراج مباشر من العميل — العميل يختار الرمز ومدة الصلاحية،\n"
                     "وهذا يخالف §2 (لا تثق بالعميل). الشاشتان ٣ و٤ مبنيتان على الدالة المقترحة."},
            {"id": "gap-warranty", "x": 1600, "y": -150, "w": 620,
             "text": "الضمان لا ينتقل: claim_warranty يتحقق من orders.customer_id،\n"
                     "فالمشتري يرى الضمان «ساري» في تقرير هبّة ولا يستطيع المطالبة به.\n"
                     "الشاشتان ٢ و٨ تقولان ذلك صراحة بدل أن تتجاهلاه."},
        ],
        "launch": {"view": "canvas"},
    }
    with open(os.path.join(here, "canvas.json"), "w", encoding="utf-8") as fh:
        json.dump(canvas, fh, ensure_ascii=False, indent=2)

    print(f"wrote {len(artboards)} artboards + canvas.json")


if __name__ == "__main__":
    main()
