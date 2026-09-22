// src/services/CumulService.js
import prisma from '../config/database.js';

const INTERNATIONAL_TYPES = ['WESTERN_UNION', 'RIA', 'MONEYGRAM'];

// Tous les types de comptes (AccountTypeEnum), pour le F1/F2 général.
const ALL_TYPES = [
  'LIQUIDE', 'ORANGE_MONEY', 'WAVE', 'UV_MASTER', 'FREE_MONEY',
  'WESTERN_UNION', 'RIA', 'MONEYGRAM', 'SEDDO', 'VERSEMENT_BANK',
  'WESTERN_2', 'RIA_2', 'AUTRES'
];

// Correspondance type → préfixe des colonnes sur DailySnapshot
// (ex: LIQUIDE → liquideDebut / liquideFin / liquideFinSecondaire)
const TYPE_FIELD_MAP = {
  LIQUIDE:        'liquide',
  ORANGE_MONEY:   'orangeMoney',
  WAVE:           'wave',
  UV_MASTER:      'uvMaster',
  FREE_MONEY:     'freeMoney',
  WESTERN_UNION:  'westernUnion',
  RIA:            'ria',
  MONEYGRAM:      'moneygram',
  SEDDO:          'seddo',
  VERSEMENT_BANK: 'versementBank',
  WESTERN_2:      'westernUnion2',
  RIA_2:          'ria2',
  AUTRES:         'autres'
};

// Marqueur utilisé dans Transaction.metadata pour isoler les opérations
// manuelles de dépôt/retrait sur le cumul total, sans toucher aux vraies
// transactions des superviseurs (qui n'ont jamais ce scope).
const CUMUL_SCOPE = 'CUMUL_TOTAL_ADJUSTMENT';

class CumulService {

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  generateDateRange(startDate, endDate) {
    const dates = [];
    const cursor = new Date(endDate);
    cursor.setHours(0, 0, 0, 0);
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    while (cursor >= start) {
      dates.push(cursor.toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() - 1);
    }
    return dates;
  }

  convertFromInt(value) { return Number(value) / 100; }

  async getSupervisors() {
    return prisma.user.findMany({
      where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
      select: { id: true, nomComplet: true }
    });
  }

  formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      weekday: 'short', day: '2-digit', month: 'short'
    });
  }

  // Extrait F1/F2 international depuis un snapshot brut (champs séparés)
  extractInternationalFromSnapshot(snapshot) {
    return {
      WESTERN_UNION: {
        f1: this.convertFromInt(snapshot.westernUnionFin   || 0),
        f2: 0, // sera rempli depuis SystemConfig
        debut: this.convertFromInt(snapshot.westernUnionDebut || 0)
      },
      RIA: {
        f1: this.convertFromInt(snapshot.riaFin   || 0),
        f2: 0,
        debut: this.convertFromInt(snapshot.riaDebut || 0)
      },
      MONEYGRAM: {
        f1: this.convertFromInt(snapshot.moneygramFin   || 0),
        f2: 0,
        debut: this.convertFromInt(snapshot.moneygramDebut || 0)
      }
    };
  }

  // Extrait F1/F2/début pour N'IMPORTE QUEL type, depuis les vraies colonnes
  // *Fin / *FinSecondaire / *Debut du snapshot (pas de SystemConfig ici,
  // contrairement à extractInternationalFromSnapshot).
  extractTypeFromSnapshot(snap, type) {
    const prefix = TYPE_FIELD_MAP[type];
    if (!prefix) return { f1: 0, f2: 0, debut: 0 };
    return {
      f1:    this.convertFromInt(snap[`${prefix}Fin`] || 0),
      f2:    this.convertFromInt(snap[`${prefix}FinSecondaire`] || 0),
      debut: this.convertFromInt(snap[`${prefix}Debut`] || 0)
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPER : charger tous les snapshots d'une plage en UNE requête
  // ══════════════════════════════════════════════════════════════════════════

  async loadAllSnapshots(supervisorIds, startDateStr, endDateStr) {
    const startDate = new Date(startDateStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);

    // 1 requête pour tous les snapshots
    const snapshots = await prisma.dailySnapshot.findMany({
      where: {
        userId: { in: supervisorIds },
        date: { gte: startDate, lte: endDate }
      },
      select: {
        userId: true,
        date: true,
        westernUnionDebut: true,
        westernUnionFin: true,
        riaDebut: true,
        riaFin: true,
        moneygramDebut: true,
        moneygramFin: true,
        liquideDebut: true,
        liquideFin: true,
        orangeMoneyDebut: true,
        orangeMoneyFin: true,
        waveDebut: true,
        waveFin: true,
        uvMasterDebut: true,
        uvMasterFin: true,
        autresDebut: true,
        autresFin: true,
        freeMoneyDebut: true,
        freeMoneyFin: true,
        seddoDebut: true,
        seddoFin: true,
        versementBankDebut: true,
        versementBankFin: true,
        westernUnion2Debut: true,
        westernUnion2Fin: true,
        ria2Debut: true,
        ria2Fin: true,
        // Colonnes F2 réelles (finSecondaire) par type — utilisées par le F1/F2 général
        liquideFinSecondaire: true,
        orangeMoneyFinSecondaire: true,
        waveFinSecondaire: true,
        uvMasterFinSecondaire: true,
        autresFinSecondaire: true,
        freeMoneyFinSecondaire: true,
        westernUnionFinSecondaire: true,
        riaFinSecondaire: true,
        moneygramFinSecondaire: true,
        seddoFinSecondaire: true,
        versementBankFinSecondaire: true,
        westernUnion2FinSecondaire: true,
        ria2FinSecondaire: true,
        debutTotal: true,
        sortieTotal: true,
        grTotal: true
      }
    });

    // 1 requête pour tous les F2 (snapshot_f2_userId_date) sur la plage
    const f2Keys = [];
    for (const snap of snapshots) {
      const dateStr = snap.date.toISOString().split('T')[0];
      f2Keys.push(`snapshot_f2_${snap.userId}_${dateStr}`);
    }

    let f2Index = {};
    if (f2Keys.length > 0) {
      const f2Configs = await prisma.systemConfig.findMany({
        where: { key: { in: f2Keys } },
        select: { key: true, value: true }
      });
      f2Configs.forEach(cfg => {
        try { f2Index[cfg.key] = JSON.parse(cfg.value); } catch { f2Index[cfg.key] = {}; }
      });
    }

    // Indexer par "YYYY-MM-DD_userId"
    const index = {};
    for (const snap of snapshots) {
      const dateStr = snap.date.toISOString().split('T')[0];
      const key = `${dateStr}_${snap.userId}`;
      const f2Data = f2Index[`snapshot_f2_${snap.userId}_${dateStr}`] || {};
      index[key] = { snap, f2Data };
    }

    console.log(`✅ [SNAPSHOT LOAD] ${snapshots.length} snapshots + ${Object.keys(f2Index).length} F2 chargés en 2 requêtes DB`);
    return index;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DONNÉES EN TEMPS RÉEL (aujourd'hui)
  // ══════════════════════════════════════════════════════════════════════════

  async getInternationalLive(dateStr) {
    try {
      console.log(`🌍 [INTL LIVE] Données temps réel pour ${dateStr}`);
      const supervisors = await this.getSupervisors();

      const totauxParOp = {
        WESTERN_UNION: { f1: 0, f2: 0, diff: 0 },
        RIA:           { f1: 0, f2: 0, diff: 0 },
        MONEYGRAM:     { f1: 0, f2: 0, diff: 0 }
      };
      const detailSups = [];

      // Charger tous les comptes en parallèle
      const allAccounts = await Promise.all(
        supervisors.map(sup =>
          prisma.account.findMany({
            where: { userId: sup.id },
            select: { type: true, balance: true, finSecondaire: true }
          }).then(accounts => ({ sup, accounts }))
        )
      );

      for (const { sup, accounts } of allAccounts) {
        const ops = {
          WESTERN_UNION: { f1: 0, f2: 0, diff: 0 },
          RIA:           { f1: 0, f2: 0, diff: 0 },
          MONEYGRAM:     { f1: 0, f2: 0, diff: 0 }
        };

        for (const account of accounts) {
          if (totauxParOp[account.type]) {
            const f1   = this.convertFromInt(account.balance       || 0);
            const f2   = this.convertFromInt(account.finSecondaire || 0);
            const diff = f2 - f1;

            ops[account.type].f1   += f1;
            ops[account.type].f2   += f2;
            ops[account.type].diff += diff;

            totauxParOp[account.type].f1   += f1;
            totauxParOp[account.type].f2   += f2;
            totauxParOp[account.type].diff += diff;
          }
        }

        const aDesDonnees = Object.values(ops).some(o => o.f1 > 0 || o.f2 > 0);
        if (aDesDonnees) {
          detailSups.push({ id: sup.id, nom: sup.nomComplet, ops, hasData: true });
        }
      }

      const totalGlobal = INTERNATIONAL_TYPES.reduce(
        (acc, t) => ({
          f1:   acc.f1   + totauxParOp[t].f1,
          f2:   acc.f2   + totauxParOp[t].f2,
          diff: acc.diff + totauxParOp[t].diff
        }),
        { f1: 0, f2: 0, diff: 0 }
      );

      return {
        success: true,
        mode: 'date_unique',
        date: dateStr,
        dateDisplay: this.formatDate(dateStr) + ' (temps réel)',
        totauxParOperateur: totauxParOp,
        totalGlobal: { ...totalGlobal, cumulativeTotal: totalGlobal.diff },
        parSuperviseur: detailSups,
        isLiveData: true
      };
    } catch (error) {
      console.error('❌ [INTL LIVE] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNATIONAL — SNAPSHOT DATE UNIQUE
  // ══════════════════════════════════════════════════════════════════════════

  async getInternationalByDate(dateStr) {
    try {
      const today = new Date().toISOString().split('T')[0];
      if (dateStr === today) return this.getInternationalLive(dateStr);

      console.log(`🌍 [INTL SNAPSHOT] ${dateStr}`);
      const supervisors = await this.getSupervisors();
      const targetDate = new Date(dateStr);
      targetDate.setHours(0, 0, 0, 0);

      // Charger snapshots + F2 en 2 requêtes
      const snapshotIndex = await this.loadAllSnapshots(
        supervisors.map(s => s.id), dateStr, dateStr
      );

      const totauxParOp = {};
      INTERNATIONAL_TYPES.forEach(t => { totauxParOp[t] = { f1: 0, f2: 0, diff: 0 }; });
      const detailSups = [];

      for (const sup of supervisors) {
        const entry = snapshotIndex[`${dateStr}_${sup.id}`];
        const ops = {};
        INTERNATIONAL_TYPES.forEach(t => { ops[t] = { f1: 0, f2: 0, diff: 0 }; });

        if (entry) {
          const { snap, f2Data } = entry;
          const raw = this.extractInternationalFromSnapshot(snap);

          for (const type of INTERNATIONAL_TYPES) {
            const f1 = raw[type].f1;
            // F2 depuis SystemConfig (snapshot_f2)
            const f2Raw = f2Data[type];
            const f2 = f2Raw !== undefined ? this.convertFromInt(BigInt(f2Raw)) : 0;
            const diff = f2 - f1;

            ops[type] = { f1, f2, diff };
            totauxParOp[type].f1   += f1;
            totauxParOp[type].f2   += f2;
            totauxParOp[type].diff += diff;
          }
        }

        detailSups.push({ id: sup.id, nom: sup.nomComplet, ops, hasData: !!entry });
      }

      const totalGlobal = INTERNATIONAL_TYPES.reduce(
        (acc, t) => ({
          f1:   acc.f1   + totauxParOp[t].f1,
          f2:   acc.f2   + totauxParOp[t].f2,
          diff: acc.diff + totauxParOp[t].diff
        }),
        { f1: 0, f2: 0, diff: 0 }
      );

      return {
        success: true,
        mode: 'date_unique',
        date: dateStr,
        dateDisplay: this.formatDate(dateStr),
        totauxParOperateur: totauxParOp,
        totalGlobal: { ...totalGlobal, cumulativeTotal: totalGlobal.diff },
        parSuperviseur: detailSups
      };
    } catch (error) {
      console.error('❌ [INTL DATE] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNATIONAL — CUMUL PLAGE (OPTIMISÉ : 2 requêtes DB au total)
  // ══════════════════════════════════════════════════════════════════════════

  async getCumulInternational(startDateStr, endDateStr) {
    if (startDateStr === endDateStr) return this.getInternationalByDate(startDateStr);

    try {
      console.log(`🌍 [CUMUL INTL] ${startDateStr} → ${endDateStr}`);
      const supervisors = await this.getSupervisors();
      const dates = this.generateDateRange(startDateStr, endDateStr);

      // ✅ 2 requêtes DB pour toute la plage (snapshots + F2)
      const snapshotIndex = await this.loadAllSnapshots(
        supervisors.map(s => s.id), startDateStr, endDateStr
      );

      const totauxParOp = {};
      INTERNATIONAL_TYPES.forEach(t => { totauxParOp[t] = { f1: 0, f2: 0, diff: 0 }; });

      let cumulativeDiffTotal = 0;
      const parJour = [];
      const parSuperviseur = {};

      supervisors.forEach(sup => {
        parSuperviseur[sup.id] = {
          id: sup.id,
          nom: sup.nomComplet,
          ops: {},
          cumulativeDiff: 0
        };
        INTERNATIONAL_TYPES.forEach(t => {
          parSuperviseur[sup.id].ops[t] = { f1: 0, f2: 0, diff: 0 };
        });
      });

      for (const dateStr of dates) {
        const dayOps = {};
        INTERNATIONAL_TYPES.forEach(t => { dayOps[t] = { f1: 0, f2: 0, diff: 0 }; });
        let dayHasData = false;

        for (const sup of supervisors) {
          const entry = snapshotIndex[`${dateStr}_${sup.id}`];
          if (!entry) continue;

          const { snap, f2Data } = entry;
          const raw = this.extractInternationalFromSnapshot(snap);

          for (const type of INTERNATIONAL_TYPES) {
            const f1 = raw[type].f1;
            const f2Raw = f2Data[type];
            const f2 = f2Raw !== undefined ? this.convertFromInt(BigInt(f2Raw)) : 0;
            const diff = f2 - f1;

            dayOps[type].f1   += f1;
            dayOps[type].f2   += f2;
            dayOps[type].diff += diff;

            totauxParOp[type].f1   += f1;
            totauxParOp[type].f2   += f2;
            totauxParOp[type].diff += diff;

            parSuperviseur[sup.id].ops[type].f1   += f1;
            parSuperviseur[sup.id].ops[type].f2   += f2;
            parSuperviseur[sup.id].ops[type].diff += diff;

            if (f1 > 0 || f2 > 0) dayHasData = true;
          }
        }

        if (dayHasData) {
          const totalJour = INTERNATIONAL_TYPES.reduce(
            (acc, t) => ({
              f1:   acc.f1   + dayOps[t].f1,
              f2:   acc.f2   + dayOps[t].f2,
              diff: acc.diff + dayOps[t].diff
            }),
            { f1: 0, f2: 0, diff: 0 }
          );

          cumulativeDiffTotal += totalJour.diff;

          parJour.push({
            date: dateStr,
            dateDisplay: this.formatDate(dateStr),
            ops: { ...dayOps },
            total: totalJour,
            cumulativeDiff: cumulativeDiffTotal
          });
        }
      }

      // Recalculer cumulativeDiff par superviseur
      for (const sup of supervisors) {
        parSuperviseur[sup.id].cumulativeDiff = INTERNATIONAL_TYPES.reduce(
          (sum, t) => sum + (parSuperviseur[sup.id].ops[t].diff || 0), 0
        );
      }

      const totalGlobal = INTERNATIONAL_TYPES.reduce(
        (acc, t) => ({
          f1:   acc.f1   + totauxParOp[t].f1,
          f2:   acc.f2   + totauxParOp[t].f2,
          diff: acc.diff + totauxParOp[t].diff
        }),
        { f1: 0, f2: 0, diff: 0 }
      );

      // ── Ajustement manuel (dépôt/retrait sur le cumul total) — totalement
      // indépendant des superviseurs et des snapshots. Ajuste uniquement le
      // total affiché, jamais parJour / parSuperviseur.
      const ajustement = await this.getAjustementCumul(startDateStr, endDateStr);

      return {
        success: true,
        mode: 'plage',
        plage: {
          debut: startDateStr,
          fin: endDateStr,
          nombreJours: dates.length,
          joursAvecDonnees: parJour.length
        },
        totauxParOperateur: totauxParOp,
        totalGlobal: {
          ...totalGlobal,
          diffSnapshots: cumulativeDiffTotal,                  // somme brute des diff (F2-F1) des snapshots
          ajustementMouvements: ajustement,                    // somme signée des dépôts/retraits manuels
          cumulativeTotal: cumulativeDiffTotal + ajustement    // ✅ total affiché au frontend
        },
        parJour: parJour.reverse(),
        parSuperviseur: Object.values(parSuperviseur).sort((a, b) => {
          const totalA = INTERNATIONAL_TYPES.reduce((s, t) => s + a.ops[t].f1, 0);
          const totalB = INTERNATIONAL_TYPES.reduce((s, t) => s + b.ops[t].f1, 0);
          return totalB - totalA;
        })
      };
    } catch (error) {
      console.error('❌ [CUMUL INTL] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUMUL TOTAL DEPUIS LE DÉBUT
  // ══════════════════════════════════════════════════════════════════════════

  async getCumulTotalGeneral() {
    try {
      console.log(`📊 [CUMUL TOTAL] Calcul depuis le début`);

      const firstSnapshot = await prisma.dailySnapshot.findFirst({
        orderBy: { date: 'asc' },
        select: { date: true }
      });

      const today = new Date().toISOString().split('T')[0];

      if (!firstSnapshot) {
        // Pas de snapshot du tout : on renvoie quand même les ajustements manuels
        const live = await this.getInternationalLive(today);
        const ajustement = await this.getAjustementCumul(null, today);
        return {
          ...live,
          totalGlobal: {
            ...live.totalGlobal,
            diffSnapshots: live.totalGlobal.diff,
            ajustementMouvements: ajustement,
            cumulativeTotal: live.totalGlobal.diff + ajustement
          }
        };
      }

      const startDate = firstSnapshot.date.toISOString().split('T')[0];
      return await this.getCumulInternational(startDate, today);

    } catch (error) {
      console.error('❌ [CUMUL TOTAL] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OPÉRATIONS SUR LE CUMUL TOTAL (dépôt / retrait / historique)
  //
  // Réutilise la table Transaction existante (type DEPOT/RETRAIT déjà dans
  // l'enum) au lieu d'une table dédiée : chaque opération est marquée par
  // metadata.scope = CUMUL_SCOPE pour être isolée des vraies transactions
  // des superviseurs. envoyeurId = l'admin qui agit ; aucun compteOrigine/
  // compteDestination n'est renseigné, donc AUCUN compte superviseur n'est
  // touché et ces lignes ne doivent jamais être comptées dans les stats
  // "transactions superviseurs" ailleurs dans l'app (toujours filtrer par
  // metadata.scope !== CUMUL_SCOPE dans ce genre de requêtes).
  // ══════════════════════════════════════════════════════════════════════════

  _isCumulOperation(tx) {
    if (!tx?.metadata) return false;
    try { return JSON.parse(tx.metadata).scope === CUMUL_SCOPE; } catch { return false; }
  }

  _formatCumulTx(tx) {
    let commentaire = null;
    try { commentaire = tx.metadata ? JSON.parse(tx.metadata).commentaire ?? null : null; } catch { /* ignore */ }
    return {
      id: tx.id,
      type: tx.type,
      montant: this.convertFromInt(tx.montant),
      description: tx.description,
      commentaire,
      createdAt: tx.createdAt,
      admin: tx.envoyeur ? { id: tx.envoyeur.id, nom: tx.envoyeur.nomComplet } : null
    };
  }

  async _createCumulOperation(type, adminId, montant, commentaire) {
    const montantNum = Number(montant);
    if (!montantNum || montantNum <= 0 || !Number.isFinite(montantNum)) {
      throw new Error('Montant invalide, doit être un nombre positif');
    }
    const commentaireClean = commentaire?.trim() || null;

    const tx = await prisma.transaction.create({
      data: {
        type,
        montant: BigInt(Math.round(montantNum * 100)),
        description: `Ajustement manuel du cumul total${commentaireClean ? ' : ' + commentaireClean : ''}`,
        envoyeurId: adminId,
        metadata: JSON.stringify({ scope: CUMUL_SCOPE, commentaire: commentaireClean })
      },
      include: { envoyeur: { select: { id: true, nomComplet: true } } }
    });

    console.log(`💰 [CUMUL] ${type} de ${montantNum.toLocaleString('fr-FR')} F créé (id: ${tx.id}, admin: ${adminId})`);

    return {
      success: true,
      ...this._formatCumulTx(tx),
      message: `${type === 'DEPOT' ? 'Dépôt' : 'Retrait'} de ${montantNum.toLocaleString('fr-FR')} F ajouté au cumul total`
    };
  }

  async createCumulDepot(adminId, montant, commentaire) {
    return this._createCumulOperation('DEPOT', adminId, montant, commentaire);
  }

  async createCumulRetrait(adminId, montant, commentaire) {
    return this._createCumulOperation('RETRAIT', adminId, montant, commentaire);
  }

  async getCumulHistory({ type, dateDebut, dateFin, page, limit } = {}) {
    const pageNum  = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));

    const where = { metadata: { contains: CUMUL_SCOPE }, archived: false };
    if (type) where.type = type.toUpperCase();
    if (dateDebut || dateFin) {
      where.createdAt = {};
      if (dateDebut) { const d = new Date(dateDebut); d.setHours(0, 0, 0, 0); where.createdAt.gte = d; }
      if (dateFin)   { const d = new Date(dateFin);   d.setHours(23, 59, 59, 999); where.createdAt.lte = d; }
    }

    const [total, transactions] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: { envoyeur: { select: { id: true, nomComplet: true } } }
      })
    ]);

    const formatted = transactions.map(t => this._formatCumulTx(t));
    const totalDepots   = formatted.filter(t => t.type === 'DEPOT').reduce((s, t) => s + t.montant, 0);
    const totalRetraits = formatted.filter(t => t.type === 'RETRAIT').reduce((s, t) => s + t.montant, 0);

    return {
      success: true,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 },
      statistiques: {
        totalDepots,
        totalRetraits,
        solde: totalDepots - totalRetraits,
        nombreOperations: total
      },
      filtresAppliques: { type: type || null, dateDebut: dateDebut || null, dateFin: dateFin || null },
      transactions: formatted
    };
  }

  async updateCumulOperationMontant(id, nouveauMontant, adminId) {
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx) throw new Error('Transaction introuvable');
    if (!this._isCumulOperation(tx)) throw new Error("Cette opération ne fait pas partie du cumul total");
    if (tx.archived) throw new Error('Cette opération a déjà été supprimée');

    const ancienMontant = this.convertFromInt(tx.montant);
    const nouveauCentimes = BigInt(Math.round(Number(nouveauMontant) * 100));
    if (nouveauCentimes === tx.montant) {
      throw new Error('Le nouveau montant est identique à l\'ancien');
    }

    const updated = await prisma.transaction.update({
      where: { id },
      data: { montant: nouveauCentimes }
    });

    console.log(`✏️ [CUMUL] Montant modifié: ${ancienMontant} → ${nouveauMontant} F (tx: ${id}, admin: ${adminId})`);

    return {
      success: true,
      transactionId: id,
      ancienMontant,
      nouveauMontant: this.convertFromInt(updated.montant),
      message: 'Montant mis à jour avec succès'
    };
  }

  async deleteCumulOperation(id, adminId) {
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx) throw new Error('Transaction introuvable');
    if (!this._isCumulOperation(tx)) throw new Error("Cette opération ne fait pas partie du cumul total");
    if (tx.archived) throw new Error('Cette opération a déjà été supprimée');

    await prisma.transaction.update({
      where: { id },
      data: { archived: true, archivedAt: new Date() }
    });

    console.log(`🗑️ [CUMUL] Opération ${id} supprimée (soft delete) par admin ${adminId}`);

    return {
      success: true,
      transactionId: id,
      ancienMontant: this.convertFromInt(tx.montant),
      type: tx.type,
      message: 'Opération supprimée avec succès'
    };
  }

  // Somme signée des ajustements validés sur une plage (dépôt = +, retrait = -)
  // start/end peuvent être null pour "depuis toujours" / "jusqu'à maintenant"
  async getAjustementCumul(startDateStr, endDateStr) {
    const where = { metadata: { contains: CUMUL_SCOPE }, archived: false };
    if (startDateStr || endDateStr) {
      where.createdAt = {};
      if (startDateStr) { const d = new Date(startDateStr); d.setHours(0, 0, 0, 0); where.createdAt.gte = d; }
      if (endDateStr)   { const d = new Date(endDateStr);   d.setHours(23, 59, 59, 999); where.createdAt.lte = d; }
    }

    const txs = await prisma.transaction.findMany({ where, select: { type: true, montant: true } });
    return txs.reduce(
      (sum, t) => sum + (t.type === 'DEPOT' ? this.convertFromInt(t.montant) : -this.convertFromInt(t.montant)),
      0
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // F1/F2 GÉNÉRAL — TOUS LES TYPES DE COMPTES
  // Même logique que l'international, mais sur ALL_TYPES et en lisant F2
  // directement depuis les colonnes *FinSecondaire du snapshot (pas de
  // SystemConfig ici — ces colonnes existent réellement dans le schema).
  // ══════════════════════════════════════════════════════════════════════════

  emptyOpsF1F2(types = ALL_TYPES) {
    const ops = {};
    types.forEach(t => { ops[t] = { f1: 0, f2: 0, diff: 0 }; });
    return ops;
  }

  async getF1F2Live(dateStr) {
    console.log(`💱 [F1F2 LIVE] Données temps réel pour ${dateStr}`);
    const supervisors = await this.getSupervisors();
    const totauxParType = this.emptyOpsF1F2();
    const detailSups = [];

    const allAccounts = await Promise.all(
      supervisors.map(sup =>
        prisma.account.findMany({
          where: { userId: sup.id },
          select: { type: true, balance: true, finSecondaire: true }
        }).then(accounts => ({ sup, accounts }))
      )
    );

    for (const { sup, accounts } of allAccounts) {
      const ops = this.emptyOpsF1F2();

      for (const account of accounts) {
        if (!ops[account.type]) continue;
        const f1   = this.convertFromInt(account.balance       || 0);
        const f2   = this.convertFromInt(account.finSecondaire || 0);
        const diff = f2 - f1;

        ops[account.type].f1   += f1;
        ops[account.type].f2   += f2;
        ops[account.type].diff += diff;

        totauxParType[account.type].f1   += f1;
        totauxParType[account.type].f2   += f2;
        totauxParType[account.type].diff += diff;
      }

      const aDesDonnees = Object.values(ops).some(o => o.f1 > 0 || o.f2 > 0);
      if (aDesDonnees) detailSups.push({ id: sup.id, nom: sup.nomComplet, ops, hasData: true });
    }

    const totalGlobal = ALL_TYPES.reduce(
      (acc, t) => ({
        f1:   acc.f1   + totauxParType[t].f1,
        f2:   acc.f2   + totauxParType[t].f2,
        diff: acc.diff + totauxParType[t].diff
      }),
      { f1: 0, f2: 0, diff: 0 }
    );

    return {
      success: true,
      mode: 'date_unique',
      date: dateStr,
      dateDisplay: this.formatDate(dateStr) + ' (temps réel)',
      totauxParType,
      totalGlobal: { ...totalGlobal, cumulativeTotal: totalGlobal.diff },
      parSuperviseur: detailSups,
      isLiveData: true
    };
  }

  async getF1F2ByDate(dateStr) {
    const today = new Date().toISOString().split('T')[0];
    if (dateStr === today) return this.getF1F2Live(dateStr);

    console.log(`💱 [F1F2 SNAPSHOT] ${dateStr}`);
    const supervisors = await this.getSupervisors();
    const snapshotIndex = await this.loadAllSnapshots(supervisors.map(s => s.id), dateStr, dateStr);

    const totauxParType = this.emptyOpsF1F2();
    const detailSups = [];

    for (const sup of supervisors) {
      const entry = snapshotIndex[`${dateStr}_${sup.id}`];
      const ops = this.emptyOpsF1F2();

      if (entry) {
        for (const type of ALL_TYPES) {
          const { f1, f2 } = this.extractTypeFromSnapshot(entry.snap, type);
          const diff = f2 - f1;
          ops[type] = { f1, f2, diff };
          totauxParType[type].f1   += f1;
          totauxParType[type].f2   += f2;
          totauxParType[type].diff += diff;
        }
      }

      detailSups.push({ id: sup.id, nom: sup.nomComplet, ops, hasData: !!entry });
    }

    const totalGlobal = ALL_TYPES.reduce(
      (acc, t) => ({
        f1:   acc.f1   + totauxParType[t].f1,
        f2:   acc.f2   + totauxParType[t].f2,
        diff: acc.diff + totauxParType[t].diff
      }),
      { f1: 0, f2: 0, diff: 0 }
    );

    return {
      success: true,
      mode: 'date_unique',
      date: dateStr,
      dateDisplay: this.formatDate(dateStr),
      totauxParType,
      totalGlobal: { ...totalGlobal, cumulativeTotal: totalGlobal.diff },
      parSuperviseur: detailSups
    };
  }

  async getCumulF1F2(startDateStr, endDateStr) {
    if (startDateStr === endDateStr) return this.getF1F2ByDate(startDateStr);

    console.log(`💱 [CUMUL F1F2] ${startDateStr} → ${endDateStr}`);
    const supervisors = await this.getSupervisors();
    const dates = this.generateDateRange(startDateStr, endDateStr);
    const snapshotIndex = await this.loadAllSnapshots(supervisors.map(s => s.id), startDateStr, endDateStr);

    const totauxParType = this.emptyOpsF1F2();
    let cumulativeDiffTotal = 0;
    const parJour = [];
    const parSuperviseur = {};

    supervisors.forEach(sup => {
      parSuperviseur[sup.id] = { id: sup.id, nom: sup.nomComplet, ops: this.emptyOpsF1F2(), cumulativeDiff: 0 };
    });

    for (const dateStr of dates) {
      const dayOps = this.emptyOpsF1F2();
      let dayHasData = false;

      for (const sup of supervisors) {
        const entry = snapshotIndex[`${dateStr}_${sup.id}`];
        if (!entry) continue;

        for (const type of ALL_TYPES) {
          const { f1, f2 } = this.extractTypeFromSnapshot(entry.snap, type);
          const diff = f2 - f1;

          dayOps[type].f1   += f1;
          dayOps[type].f2   += f2;
          dayOps[type].diff += diff;

          totauxParType[type].f1   += f1;
          totauxParType[type].f2   += f2;
          totauxParType[type].diff += diff;

          parSuperviseur[sup.id].ops[type].f1   += f1;
          parSuperviseur[sup.id].ops[type].f2   += f2;
          parSuperviseur[sup.id].ops[type].diff += diff;

          if (f1 > 0 || f2 > 0) dayHasData = true;
        }
      }

      if (dayHasData) {
        const totalJour = ALL_TYPES.reduce(
          (acc, t) => ({
            f1:   acc.f1   + dayOps[t].f1,
            f2:   acc.f2   + dayOps[t].f2,
            diff: acc.diff + dayOps[t].diff
          }),
          { f1: 0, f2: 0, diff: 0 }
        );
        cumulativeDiffTotal += totalJour.diff;

        parJour.push({
          date: dateStr,
          dateDisplay: this.formatDate(dateStr),
          ops: { ...dayOps },
          total: totalJour,
          cumulativeDiff: cumulativeDiffTotal
        });
      }
    }

    for (const sup of supervisors) {
      parSuperviseur[sup.id].cumulativeDiff = ALL_TYPES.reduce(
        (sum, t) => sum + (parSuperviseur[sup.id].ops[t].diff || 0), 0
      );
    }

    const totalGlobal = ALL_TYPES.reduce(
      (acc, t) => ({
        f1:   acc.f1   + totauxParType[t].f1,
        f2:   acc.f2   + totauxParType[t].f2,
        diff: acc.diff + totauxParType[t].diff
      }),
      { f1: 0, f2: 0, diff: 0 }
    );

    return {
      success: true,
      mode: 'plage',
      plage: { debut: startDateStr, fin: endDateStr, nombreJours: dates.length, joursAvecDonnees: parJour.length },
      totauxParType,
      totalGlobal: { ...totalGlobal, cumulativeTotal: cumulativeDiffTotal },
      parJour: parJour.reverse(),
      parSuperviseur: Object.values(parSuperviseur).sort((a, b) => {
        const totalA = ALL_TYPES.reduce((s, t) => s + a.ops[t].f1, 0);
        const totalB = ALL_TYPES.reduce((s, t) => s + b.ops[t].f1, 0);
        return totalB - totalA;
      })
    };
  }

  async getCumulF1F2ByPreset(preset) {
    const { startDate, endDate } = this._presetToDates(preset, { '2j': 2, '3j': 3, '1m': 30, '1an': 365 });
    return this.getCumulF1F2(startDate, endDate);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FULL CUMUL — vue combinée : F1/F2 tous types + ajustement manuel du
  // cumul total (dépôts/retraits). Ne recalcule rien en double : réutilise
  // getCumulF1F2 et ajoute juste l'ajustement + l'historique par-dessus.
  // ══════════════════════════════════════════════════════════════════════════

  async getFullCumul(startDateStr, endDateStr) {
    const [base, ajustement] = await Promise.all([
      this.getCumulF1F2(startDateStr, endDateStr),
      this.getAjustementCumul(startDateStr, endDateStr)
    ]);

    return {
      ...base,
      totalGlobal: {
        ...base.totalGlobal,
        diffSnapshots: base.totalGlobal.cumulativeTotal,
        ajustementMouvements: ajustement,
        cumulativeTotal: base.totalGlobal.cumulativeTotal + ajustement
      }
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PRESETS
  // ══════════════════════════════════════════════════════════════════════════

  async getCumulInternationalByPreset(preset) {
    const { startDate, endDate } = this._presetToDates(preset, { '1m': 30, '3m': 90, '6m': 180, '1an': 365 });
    return this.getCumulInternational(startDate, endDate);
  }

  _presetToDates(preset, map) {
    const daysBack = map[preset] ?? 30;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(today.getDate() - 1);
    const start = new Date(today);
    start.setDate(today.getDate() - daysBack);
    return {
      startDate: start.toISOString().split('T')[0],
      endDate:   end.toISOString().split('T')[0]
    };
  }
}

export default new CumulService();