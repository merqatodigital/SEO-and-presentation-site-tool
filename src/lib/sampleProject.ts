import { ProjectBrief, ScreenshotAsset, WalkthroughData } from '../types/tour';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function createCanvasFrame(
  drawFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): string {
  const width = 1280;
  const height = 760;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Base crisp page background
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, width, height);

  // Subtle browser chrome
  ctx.fillStyle = '#E2E8F0';
  ctx.fillRect(0, 0, width, 44);
  ['#94A3B8', '#CBD5E1', '#CBD5E1'].forEach((color, idx) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(24 + idx * 18, 22, 5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#FFFFFF';
  drawRoundedRect(ctx, 96, 10, 420, 24, 6);
  ctx.fill();
  ctx.fillStyle = '#64748B';
  ctx.font = '12px sans-serif';
  ctx.fillText('harborcrest-dental.example', 112, 26);

  drawFn(ctx, width, height);
  return canvas.toDataURL('image/png');
}

export function buildSampleScreenshots(): ScreenshotAsset[] {
  const shot1 = createCanvasFrame((ctx, w) => {
    // Top nav
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 44, w, 72);
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('Harborcrest Dental', 72, 88);
    ctx.fillStyle = '#475569';
    ctx.font = '15px sans-serif';
    ctx.fillText('Treatments   Our Team   Patient Reviews   Contact', 620, 86);
    ctx.fillStyle = '#0F766E';
    drawRoundedRect(ctx, 1030, 62, 178, 38, 8);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('Book Visit Online', 1058, 86);

    // Hero area
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 46px sans-serif';
    ctx.fillText('Calm, Modern Family Dentistry', 72, 230);
    ctx.fillText('Right on Your Schedule', 72, 286);
    ctx.fillStyle = '#475569';
    ctx.font = '20px sans-serif';
    ctx.fillText('Same-week checkups, transparent pricing, and gentle care', 72, 336);
    ctx.fillText('for adults and kids in North Harbor.', 72, 366);

    // Direct booking CTA
    ctx.fillStyle = '#0F766E';
    drawRoundedRect(ctx, 72, 408, 250, 56, 10);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('Reserve Appointment', 110, 442);

    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, 340, 408, 210, 56, 10);
    ctx.stroke();
    ctx.fillStyle = '#0F172A';
    ctx.fillText('Call (555) 239-0180', 368, 442);

    // Hero right clinic card
    ctx.fillStyle = '#E6F4F1';
    drawRoundedRect(ctx, 730, 160, 478, 480, 18);
    ctx.fill();
    ctx.fillStyle = '#115E59';
    drawRoundedRect(ctx, 770, 200, 398, 260, 12);
    ctx.fill();
    ctx.fillStyle = '#CCFBF1';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('Bright Treatment Suite', 845, 335);
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('4.9 / 5 from 340+ local families', 770, 505);
    ctx.fillStyle = '#475569';
    ctx.font = '15px sans-serif';
    ctx.fillText('Open Mon-Sat · Evening slots available', 770, 535);
  });

  const shot2 = createCanvasFrame((ctx, w) => {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 44, w, 716);
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('Choose Your Visit & Time in 60 Seconds', 72, 132);
    ctx.fillStyle = '#64748B';
    ctx.font = '18px sans-serif';
    ctx.fillText('No phone hold music. Instant confirmation sent to your phone.', 72, 168);

    // Booking panel
    ctx.fillStyle = '#F8FAFC';
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, 72, 210, 740, 460, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('1. Select Care Type', 108, 258);
    ['New Patient Cleaning', 'Emergency Toothache', 'Invisalign Consult'].forEach((item, i) => {
      ctx.fillStyle = i === 0 ? '#0F766E' : '#FFFFFF';
      ctx.strokeStyle = i === 0 ? '#0F766E' : '#CBD5E1';
      drawRoundedRect(ctx, 108 + i * 224, 280, 208, 54, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = i === 0 ? '#FFFFFF' : '#0F172A';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(item, 124 + i * 224, 312);
    });

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('2. Available Tomorrow', 108, 386);
    ['9:00 AM', '11:30 AM', '2:15 PM', '5:30 PM'].forEach((slot, i) => {
      ctx.fillStyle = i === 2 ? '#CCFBF1' : '#FFFFFF';
      ctx.strokeStyle = i === 2 ? '#0F766E' : '#CBD5E1';
      drawRoundedRect(ctx, 108 + i * 165, 410, 148, 52, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(slot, 145 + i * 165, 442);
    });

    ctx.fillStyle = '#0F766E';
    drawRoundedRect(ctx, 108, 510, 668, 56, 10);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('Confirm My 2:15 PM Visit — No Prepayment Needed', 210, 544);

    // Right sidebar summary
    ctx.fillStyle = '#0F172A';
    drawRoundedRect(ctx, 848, 210, 360, 460, 14);
    ctx.fill();
    ctx.fillStyle = '#5EEAD4';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('24/7 CARE DESK ASSISTANT', 884, 260);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '18px sans-serif';
    ctx.fillText('"Do you accept Delta PPO?"', 884, 320);
    ctx.fillStyle = '#CBD5E1';
    ctx.font = '16px sans-serif';
    ctx.fillText('Yes! We submit claims directly', 884, 370);
    ctx.fillText('for Delta, Cigna, and MetLife,', 884, 396);
    ctx.fillText('even if you message at 2am.', 884, 422);
  });

  const shot3 = createCanvasFrame((ctx) => {
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('Meet the Doctors & Real Patient Stories', 72, 130);

    const cards = [
      { name: 'Dr. Elena Rostova, DDS', role: '14 Years · Family & Restorative', quote: '"Explained every step clearly and my kids loved the visit."' },
      { name: 'Dr. Marcus Vance, DMD', role: '11 Years · Gentle Cosmetic Care', quote: '"Booked online at 10pm and got seen the very next morning."' },
      { name: 'Verified Local Reviews', role: '4.9 Stars · North Harbor', quote: '"Zero surprise bills and the cleanest clinic in town."' },
    ];

    cards.forEach((c, idx) => {
      const x = 72 + idx * 388;
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#E2E8F0';
      drawRoundedRect(ctx, x, 185, 360, 470, 14);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = idx === 2 ? '#0F766E' : '#CBD5E1';
      drawRoundedRect(ctx, x + 24, 212, 312, 200, 10);
      ctx.fill();

      ctx.fillStyle = idx === 2 ? '#FFFFFF' : '#334155';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(idx === 2 ? '340+ Local 5-Star Reviews' : 'Clinic Portrait', x + 56, 320);

      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 19px sans-serif';
      ctx.fillText(c.name, x + 24, 456);
      ctx.fillStyle = '#0F766E';
      ctx.font = '14px sans-serif';
      ctx.fillText(c.role, x + 24, 484);
      ctx.fillStyle = '#475569';
      ctx.font = '15px sans-serif';
      ctx.fillText(c.quote.slice(0, 36), x + 24, 534);
      ctx.fillText(c.quote.slice(36), x + 24, 558);
    });
  });

  const shot4 = createCanvasFrame((ctx) => {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 44, 1280, 716);
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('Automated Reminders & Patient Retention', 72, 130);
    ctx.fillStyle = '#475569';
    ctx.font = '18px sans-serif';
    ctx.fillText('Keep your chairs full without your front desk chasing phone calls.', 72, 166);

    const rows = [
      { label: 'Instant SMS Confirmation', detail: 'Sent automatically seconds after online booking', stat: '0 missed leads' },
      { label: '48-Hour Visit Reminder', detail: 'Reduces last-minute no-shows with one-tap confirm', stat: '-62% no-shows' },
      { label: '6-Month Hygiene Recall', detail: 'Friendly automatic check-in brings families back', stat: '2027 growth ready' },
    ];

    rows.forEach((row, idx) => {
      const y = 216 + idx * 145;
      ctx.fillStyle = '#F8FAFC';
      ctx.strokeStyle = '#CBD5E1';
      drawRoundedRect(ctx, 72, y, 1136, 118, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 21px sans-serif';
      ctx.fillText(row.label, 108, y + 48);
      ctx.fillStyle = '#475569';
      ctx.font = '16px sans-serif';
      ctx.fillText(row.detail, 108, y + 80);

      ctx.fillStyle = '#0F766E';
      drawRoundedRect(ctx, 940, y + 34, 232, 48, 8);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(row.stat, 976, y + 64);
    });
  });

  return [
    { id: 'sample-1', name: '01-homepage-hero.png', dataUrl: shot1, width: 1280, height: 760 },
    { id: 'sample-2', name: '02-online-booking.png', dataUrl: shot2, width: 1280, height: 760 },
    { id: 'sample-3', name: '03-doctors-trust.png', dataUrl: shot3, width: 1280, height: 760 },
    { id: 'sample-4', name: '04-patient-followups.png', dataUrl: shot4, width: 1280, height: 760 },
  ];
}

export const SAMPLE_PROJECT_BRIEF: ProjectBrief = {
  clientName: 'Harborcrest Dental Studio',
  businessType: 'Family & Cosmetic Dentistry',
  brief:
    'We want local families to book checkups directly on our website instead of calling during busy hours or drifting to third-party directories that charge fees. We also miss evening insurance questions and want steady 6-month recall visits heading into 2027.',
  brandColor: '#0F766E',
  logoDataUrl: null,
};

export const SAMPLE_WALKTHROUGH: WalkthroughData = {
  title: 'More Direct Family Bookings & Round-the-Clock Care for Harborcrest Dental',
  scenes: [
    {
      screenshotIndex: 0,
      caption: 'More direct bookings the moment families arrive',
      narration:
        'Win more direct bookings without paying directory commissions. Visitors immediately see your welcoming promise and a clear button to reserve an appointment.',
      highlight: { x: 5, y: 52, w: 22, h: 10 },
    },
    {
      screenshotIndex: 1,
      caption: 'Answers insurance questions even at 2am',
      narration:
        'Capture fewer missed inquiries while your clinic is closed. Your after-hours assistant answers common insurance questions at 2am and guides patients into open time slots.',
      highlight: { x: 65, y: 27, w: 30, h: 61 },
    },
    {
      screenshotIndex: 2,
      caption: 'Real team photos build instant family trust',
      narration:
        'Earn immediate trust from photos before patients ever walk through your door. Warm doctor portraits paired with verified neighborhood reviews reassure anxious parents.',
      highlight: { x: 5, y: 24, w: 58, h: 62 },
    },
    {
      screenshotIndex: 3,
      caption: 'Full chairs and steady growth into 2027',
      narration:
        'Keep your schedule full with automatic reminders and checkup recalls, setting Harborcrest Dental up for predictable digital growth into 2027.',
      highlight: { x: 72, y: 28, w: 21, h: 55 },
    },
  ],
  outcomes: [
    {
      title: 'More Direct Bookings, Zero Commission',
      description:
        'Families reserve open hygiene and consultation times directly on your site without third-party booking fees.',
    },
    {
      title: 'Replies at 2am When Phones Are Off',
      description:
        'Evening visitors get clear answers about accepted insurance plans and tomorrow’s openings immediately.',
    },
    {
      title: 'Instant Trust Before the First Visit',
      description:
        'Authentic doctor portraits and 340+ local reviews turn hesitant searchers into confident booked patients.',
    },
    {
      title: 'Fewer No-Shows & Missed Recalls',
      description:
        'Automatic confirmation texts and six-month checkup reminders fill your calendar without front-desk chasing.',
    },
  ],
  roadmap: [
    {
      quarter: 'Q1',
      items: [
        'Launch streamlined homepage with direct online booking',
        'Highlight real doctor portraits and local family reviews',
      ],
    },
    {
      quarter: 'Q2',
      items: [
        'Enable 24/7 insurance & new-patient inquiry assistant',
        'Connect automatic SMS confirmations and 48-hour reminders',
      ],
    },
    {
      quarter: 'Q3',
      items: [
        'Turn on automated six-month hygiene recall campaigns',
        'Add post-visit direct patient feedback & testimonial capture',
      ],
    },
    {
      quarter: 'Q4',
      items: [
        'Review full-year direct booking growth and patient retention',
        'Expand local neighborhood spotlight pages for 2027',
      ],
    },
  ],
};
