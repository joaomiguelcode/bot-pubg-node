import * as ranking from './ranking.js';
import * as perfil from './perfil.js';
import * as registrar from './registrar.js';
import * as desvincular from './desvincular.js';
import * as comparar from './comparar.js';
import * as membros from './membros.js';
import * as ajuda from './ajuda.js';
import * as status from './status.js';

export const commands = new Map();

const commandList = [ranking, perfil, registrar, desvincular, comparar, membros, ajuda, status];


for (const cmd of commandList) {
  if (cmd.data && cmd.data.name) {
    commands.set(cmd.data.name, cmd);
  }
}

export function getAllSlashCommandsJSON() {
  return commandList.map((cmd) => cmd.data.toJSON());
}
