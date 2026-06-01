/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function up(knex) {
  await knex.schema.alterTable("links", table => {
    table.index(["address", "domain_id"], "links_address_domain_id_index");
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function down(knex) {
  await knex.schema.alterTable("links", table => {
    table.dropIndex(["address", "domain_id"], "links_address_domain_id_index");
  });
}

module.exports = {
  up,
  down,
}
