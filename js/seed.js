/* ============================================================
   seed.js — the syllabus, generated from the "To do" workbook.

   Each entry is [name, weight, bookCodes, coverageCodes].

     weight        1.0 is an average chapter; drives the default
                   estimate (see POMO_PLAN and STRENGTH in config.js).
     bookCodes     one letter per book that applies to this subject,
                   in BOOKS order. Physics: Exercise, Exemplar,
                   HC Verma, IIG, FIITJEE, IRODOV. Chemistry:
                   Exercise, Exemplar, IIG, Cengage. Maths: Exercise,
                   Exemplar, IIG, FIITJEE, Cengage.
     coverageCodes two letters: School, Coaching.

   Codes: C completed - P in progress - D doubts - N not yet started.

   Every book in the workbook is seeded here, including the ones
   switched off for the Main phase. Their marks sit in storage
   untouched, so turning a book back on in Settings restores its
   history rather than starting it from blank.
   ============================================================ */
window.OS = window.OS || {};

OS.SEED = {
  Physics: {
    11: [
      ['Units and Measurements',                    0.8, 'CCCNCC', 'CC'],
      ['Motion in a Straight Line',                 0.9, 'CCCCDP', 'CC'],
      ['Motion in a Plane',                         1.1, 'CNCCNN', 'CC'],
      ['Laws of Motion',                            1.2, 'CNCCNN', 'CC'],
      ['Work, Energy and Power',                    1.1, 'CNCDNN', 'CC'],
      ['System of Particles and Rotational Motion', 1.5, 'PNCCNN', 'CC'],
      ['Gravitation',                               1.0, 'DNCPNN', 'CC'],
      ['Mechanical Properties of Solids',           0.7, 'CNNPNN', 'CC'],
      ['Mechanical Properties of Fluids',           1.0, 'CNNDNN', 'CC'],
      ['Thermal Properties of Matter',              0.9, 'NNNNNN', 'CC'],
      ['Thermodynamics',                            1.0, 'CNNDNN', 'CC'],
      ['Kinetic Theory',                            0.8, 'NNNPNN', 'CC'],
      ['Oscillations',                              1.2, 'PNNNNN', 'CC'],
      ['Waves',                                     1.2, 'DNPNNN', 'CC']
    ],
    12: [
      ['Electric Charges and Fields',                                       1.2, 'CNCDNN', 'CC'],
      ['Electrostatic Potential and Capacitance',                           1.3, 'CNPDNN', 'CC'],
      ['Current Electricity',                                               1.2, 'NNCPNN', 'CC'],
      ['Moving Charges and Magnetism',                                      1.3, 'DNNNNN', 'CC'],
      ['Magnetism and Matter',                                              0.8, 'DNNNNN', 'CC'],
      ['Electromagnetic Induction',                                         1.1, 'PNNNNN', 'CC'],
      ['Alternating Current',                                               1.0, 'DNNNNN', 'CP'],
      ['Electromagnetic Waves',                                             0.5, 'NNNNNN', 'NN'],
      ['Ray Optics and Optical Instruments',                                1.4, 'DNNNNN', 'CP'],
      ['Wave Optics',                                                       1.1, 'NNNNNN', 'DN'],
      ['Dual Nature of Radiation and Matter',                               0.8, 'NNNNNN', 'NN'],
      ['Atoms',                                                             0.7, 'NNNNNN', 'NN'],
      ['Nuclei',                                                            0.8, 'NNNNNN', 'NN'],
      ['Semiconductor Electronics: Materials, Devices and Simple Circuits', 1.0, 'NNNNNN', 'NN'],
      ['Communication Systems',                                             0.5, 'NNNNNN', 'NN']
    ]
  },
  Chemistry: {
    11: [
      ['Some Basic Concepts of Chemistry',                         1.0, 'CCCP', 'CC'],
      ['Structure of Atom',                                        1.1, 'CNCN', 'CC'],
      ['Redox Reactions',                                          0.7, 'CNCN', 'CC'],
      ['Classification of Elements and Periodicity in Properties', 0.9, 'CNCN', 'CC'],
      ['Chemical Bonding and Molecular Structure',                 1.4, 'CNDN', 'CC'],
      ['Thermodynamics',                                           1.2, 'CNCN', 'CC'],
      ['Equilibrium',                                              1.4, 'CNCN', 'CC'],
      ['s-Block Elements (Alkali and Alkaline Earth Metals)',      0.7, 'NNNN', 'CC'],
      ['Some p-Block Elements (Groups 13 & 14)',                   0.9, 'CNNN', 'CC'],
      ['Organic Chemistry – Some Basic Principles and Techniques', 1.4, 'PNPN', 'CC'],
      ['Hydrocarbons',                                             1.2, 'DNPN', 'CC'],
      ['Environmental Chemistry',                                  0.4, 'NNNN', 'CC']
    ],
    12: [
      ['Solutions',                                                 1.0, 'CNCN', 'CC'],
      ['Electrochemistry',                                          1.2, 'CNPN', 'CC'],
      ['Chemical Kinetics',                                         1.0, 'CNNN', 'CC'],
      ['Surface Chemistry',                                         0.6, 'NNNN', 'NN'],
      ['General Principles and Processes of Isolation of Elements', 0.6, 'NNNN', 'NN'],
      ['The p-Block Elements (Groups 15, 16, 17, 18)',              1.3, 'NNNN', 'CC'],
      ['The d- and f-Block Elements',                               1.0, 'PNNN', 'CC'],
      ['Coordination Compounds',                                    1.2, 'DNNN', 'CC'],
      ['Haloalkanes and Haloarenes',                                1.0, 'DNNN', 'CC'],
      ['Alcohols, Phenols and Ethers',                              1.1, 'CNNN', 'CC'],
      ['Aldehydes, Ketones and Carboxylic Acids',                   1.3, 'DNNN', 'NN'],
      ['Amines',                                                    1.0, 'NNNN', 'NN'],
      ['Biomolecules',                                              0.7, 'PNNN', 'CC'],
      ['Polymers',                                                  0.5, 'NNNN', 'NN'],
      /* Deleted on the live board. Kept here because chapter ids are
         numbered in seed order: removing a row would renumber every
         chapter after it and break merging with existing boards. */
      ['Chemistry in Everyday Life',                                0.5, 'NNNN', 'NN']
    ]
  },
  Maths: {
    11: [
      ['Sets',                                       0.6, 'CCCDN', 'CC'],
      ['Relations & Functions',                      0.9, 'CPCPN', 'CC'],
      ['Trigonometric Functions',                    1.3, 'CNCDP', 'CC'],
      ['Logarithm',                                  0.5, 'CCCDP', 'CC'],
      ['Complex Numbers and Quadratic Equations',    1.2, 'CNCCP', 'CC'],
      ['Linear Inequalities',                        0.5, 'CNCDN', 'CC'],
      ['Permutations and Combinations',              1.2, 'CNCNN', 'CC'],
      ['Binomial Theorem',                           1.0, 'CNCNN', 'CC'],
      ['Sequences and Series',                       1.2, 'CNCNN', 'CC'],
      ['Straight Lines',                             1.1, 'NNDNN', 'CC'],
      ['Conic Sections',                             1.4, 'CNPNN', 'CC'],
      ['Introduction to Three Dimensional Geometry', 0.5, 'CNPNN', 'CC'],
      ['Limits and Derivatives',                     1.1, 'CNCNN', 'CC'],
      ['Statistics',                                 0.6, 'CNNNN', 'CC'],
      ['Probability',                                0.9, 'CNPNN', 'CC']
    ],
    12: [
      ['Relations and Functions',          0.9, 'CNPNN', 'CC'],
      ['Inverse Trigonometric Functions',  0.9, 'CCCNN', 'CC'],
      ['Matrices',                         1.0, 'CCDNN', 'CC'],
      ['Determinants',                     1.0, 'CCCNN', 'CC'],
      ['Continuity and Differentiability', 1.3, 'CNPNN', 'CC'],
      ['Application of Derivatives',       1.3, 'CNNNN', 'CC'],
      ['Integrals',                        1.6, 'PNNNN', 'CC'],
      ['Application of Integrals',         0.8, 'CNNNN', 'CC'],
      ['Differential Equations',           1.1, 'PNNNN', 'CC'],
      ['Vector Algebra',                   0.9, 'NNNNN', 'CP'],
      ['Three Dimensional Geometry',       1.1, 'NNNNN', 'NN'],
      ['Linear Programming',               0.5, 'NNNNN', 'NC'],
      ['Probability',                      0.9, 'NNNNN', 'NN']
    ]
  }
};

/* Turn the terse seed tables into full chapter records. */
OS.buildSeedChapters = function () {
  const C = OS.CONFIG;
  const out = [];
  let n = 0;

  C.SUBJECT_ORDER.forEach(subject => {
    [11, 12].forEach(cls => {
      (OS.SEED[subject]?.[cls] || []).forEach((entry, i) => {
        const [name, w, bookCodes, coverCodes] = entry;
        const books = {};
        let slot = 0;
        C.BOOKS.forEach(b => {
          if (!OS.bookApplies(b.key, subject)) return;
          const code = bookCodes ? bookCodes[slot] : null;
          slot++;
          books[b.key] = {
            s: (code && C.CODE[code]) || 'NYS',
            e: OS.estimateFor({ subject, cls, name, w }, b.key),
            t: 0
          };
        });
        out.push({
          id: 'c' + (++n).toString(36).padStart(3, '0'),
          subject, cls, name, w,
          seq: i + 1,
          books,
          School: (coverCodes && C.CODE[coverCodes[0]]) || 'NYS',
          Coaching: (coverCodes && C.CODE[coverCodes[1]]) || 'NYS',
          t: 0, tS: 0, tC: 0, note: ''
        });
      });
    });
  });
  return out;
};
