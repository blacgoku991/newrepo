'use strict';

/**
 * Surcharges de scénario éditées depuis le panel admin (table scenario_overrides).
 *
 * Format : {
 *   disabled:  [stepId, …]                    — étapes natives désactivées (si non critiques)
 *   selectors: { "chemin.du.selecteur": "…" } — sélecteurs remplacés (ex. "form.nom")
 *   custom:    [ { id, after, label, action, selector, value, sourceField } ]
 *               — étapes simples insérées après l'étape native `after`
 *                 (after = null → au tout début). Actions : goto, fill, click,
 *                 selectOption, check, waitForSelector, wait.
 * }
 *
 * Les étapes natives portent { id, label, critical } : une étape critique
 * (connexion, enregistrement…) ne peut jamais être désactivée.
 */

const db = require('../db');

/** Applique les remplacements de sélecteurs à une copie profonde du module selectors. */
function applySelectorPatches(selectors, appId) {
  const patches = (db.getScenarioOverrides(appId) || {}).selectors || {};
  const clone = structuredClone
    ? structuredClone(selectorsToPlain(selectors))
    : JSON.parse(JSON.stringify(selectorsToPlain(selectors)));
  // Les fonctions du module selectors ne survivent pas au clonage : on les rattache.
  reattachFunctions(selectors, clone);
  for (const [path, value] of Object.entries(patches)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const keys = path.split('.');
    let node = clone;
    for (let i = 0; i < keys.length - 1; i++) {
      if (node == null || typeof node !== 'object') { node = null; break; }
      node = node[keys[i]];
    }
    const leaf = keys[keys.length - 1];
    if (node && typeof node === 'object' && typeof node[leaf] === 'string') {
      node[leaf] = value;
    }
  }
  return clone;
}

function selectorsToPlain(obj) {
  // Retire les fonctions pour le clonage (elles sont rattachées ensuite).
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'function') continue;
    out[k] = v && typeof v === 'object' && !(v instanceof RegExp) ? selectorsToPlain(v) : v;
  }
  return out;
}

function reattachFunctions(src, dst) {
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === 'function') dst[k] = v;
    else if (v && typeof v === 'object' && !(v instanceof RegExp) && dst[k]) reattachFunctions(v, dst[k]);
    else if (v instanceof RegExp) dst[k] = v;
  }
}

/** Construit l'exécuteur d'une étape personnalisée simple. */
function customStepRunner(step, data) {
  return async (page) => {
    const value = step.sourceField ? String(data[step.sourceField] ?? '') : String(step.value ?? '');
    switch (step.action) {
      case 'goto':
        await page.goto(value || step.selector);
        break;
      case 'fill':
        await page.locator(step.selector).first().fill(value);
        break;
      case 'click':
        await page.locator(step.selector).first().click();
        break;
      case 'selectOption':
        await page.locator(step.selector).first().selectOption(value);
        break;
      case 'check':
        await page.locator(step.selector).first().check();
        break;
      case 'waitForSelector':
        await page.locator(step.selector).first().waitFor();
        break;
      case 'wait':
        await page.waitForTimeout(Math.min(Number(value) || 1000, 30000));
        break;
      default:
        throw new Error(`Action personnalisée inconnue : ${step.action}`);
    }
  };
}

/**
 * Applique les surcharges à la liste d'étapes natives d'un scénario :
 * filtre les étapes désactivées (non critiques) et insère les étapes
 * personnalisées à leur position.
 */
function composeSteps(appId, nativeSteps, data, log) {
  const ov = db.getScenarioOverrides(appId) || {};
  const disabled = new Set(ov.disabled || []);
  const custom = ov.custom || [];

  const result = [];
  const pushCustomAfter = (anchorId) => {
    for (const c of custom) {
      if ((c.after || null) === anchorId) {
        result.push({
          id: c.id,
          label: `[perso] ${c.label || c.action}`,
          custom: true,
          run: customStepRunner(c, data),
        });
      }
    }
  };

  pushCustomAfter(null); // étapes personnalisées placées au début
  for (const step of nativeSteps) {
    if (disabled.has(step.id) && !step.critical) {
      log(`Étape « ${step.label} » désactivée depuis le panel admin : ignorée`);
    } else {
      result.push(step);
    }
    pushCustomAfter(step.id);
  }
  return result;
}

/** Validation d'une surcharge de scénario envoyée par l'admin. */
function validateScenarioOverrides(stepsMeta, ov) {
  const errors = [];
  const ids = new Set(stepsMeta.map((s) => s.id));
  const criticals = new Set(stepsMeta.filter((s) => s.critical).map((s) => s.id));
  const ACTIONS = ['goto', 'fill', 'click', 'selectOption', 'check', 'waitForSelector', 'wait'];

  for (const id of ov.disabled || []) {
    if (!ids.has(id)) errors.push(`Étape inconnue : ${id}`);
    if (criticals.has(id)) errors.push(`L'étape « ${id} » est critique : elle ne peut pas être désactivée`);
  }
  for (const c of ov.custom || []) {
    if (!c.id || !/^[a-z0-9_-]{1,40}$/.test(c.id)) errors.push(`Id d'étape personnalisée invalide : ${c.id || '(vide)'}`);
    if (!ACTIONS.includes(c.action)) errors.push(`Action invalide : ${c.action}`);
    if (c.after && !ids.has(c.after)) errors.push(`Ancrage inconnu pour « ${c.id} » : ${c.after}`);
    if (['fill', 'click', 'selectOption', 'check', 'waitForSelector'].includes(c.action) && !c.selector) {
      errors.push(`« ${c.id} » (${c.action}) doit avoir un sélecteur`);
    }
  }
  for (const [path, value] of Object.entries(ov.selectors || {})) {
    if (typeof value !== 'string') errors.push(`Sélecteur invalide pour ${path}`);
  }
  return errors;
}

module.exports = { applySelectorPatches, composeSteps, validateScenarioOverrides };
