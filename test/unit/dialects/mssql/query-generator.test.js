'use strict';

const Support = require('../../../support');

const expectsql = Support.expectsql;
const current = Support.sequelize;
const { DataTypes, Op, TableHints } = require('@sequelize/core');
const { MsSqlQueryGenerator: QueryGenerator } = require('@sequelize/core/_non-semver-use-at-your-own-risk_/dialects/mssql/query-generator.js');
const { _validateIncludedElements } = require('@sequelize/core/_non-semver-use-at-your-own-risk_/model-internals.js');

if (current.dialect.name === 'mssql') {
  describe('[MSSQL Specific] QueryGenerator', () => {
    before(function () {
      this.queryGenerator = new QueryGenerator({
        sequelize: this.sequelize,
        dialect: this.sequelize.dialect,
      });
    });

    it('upsertQuery with falsey values', function () {
      const testTable = this.sequelize.define(
        'test_table',
        {
          Name: {
            type: DataTypes.STRING,
            primaryKey: true,
          },
          Age: {
            type: DataTypes.INTEGER,
          },
          IsOnline: {
            type: DataTypes.BOOLEAN,
            primaryKey: true,
          },
        },
        {
          freezeTableName: true,
          timestamps: false,
        },
      );

      const insertValues = {
        Name: 'Charlie',
        Age: 24,
        IsOnline: false,
      };

      const updateValues = {
        Age: 24,
      };

      const whereValues = [
        {
          Name: 'Charlie',
          IsOnline: false,
        },
      ];

      const where = {
        [Op.or]: whereValues,
      };

      // the main purpose of this test is to validate this does not throw
      expectsql(this.queryGenerator.upsertQuery('test_table', updateValues, insertValues, where, testTable), {
        mssql:
          'MERGE INTO [test_table] WITH(HOLDLOCK) AS [test_table_target] USING (VALUES(24)) AS [test_table_source]([Age]) ON [test_table_target].[Name] = [test_table_source].[Name] AND [test_table_target].[IsOnline] = [test_table_source].[IsOnline] WHEN MATCHED THEN UPDATE SET [test_table_target].[Name] = N\'Charlie\', [test_table_target].[Age] = 24, [test_table_target].[IsOnline] = 0 WHEN NOT MATCHED THEN INSERT ([Age]) VALUES(24) OUTPUT $action, INSERTED.*;',
      });
    });

    it('createTableQuery', function () {
      expectsql(this.queryGenerator.createTableQuery('myTable', { int: 'INTEGER' }, {}), {
        mssql: `IF OBJECT_ID(N'[myTable]', 'U') IS NULL CREATE TABLE [myTable] ([int] INTEGER);`,
      });
    });

    it('createTableQuery with comments', function () {
      expectsql(this.queryGenerator.createTableQuery('myTable', { int: 'INTEGER COMMENT Foo Bar', varchar: 'VARCHAR(50) UNIQUE COMMENT Bar Foo' }, {}), { mssql: `IF OBJECT_ID(N'[myTable]', 'U') IS NULL CREATE TABLE [myTable] ([int] INTEGER, [varchar] VARCHAR(50) UNIQUE); EXEC sp_addextendedproperty @name = N'MS_Description', @value = N'Foo Bar', @level0type = N'Schema', @level0name = 'dbo', @level1type = N'Table', @level1name = [myTable], @level2type = N'Column', @level2name = [int]; EXEC sp_addextendedproperty @name = N'MS_Description', @value = N'Bar Foo', @level0type = N'Schema', @level0name = 'dbo', @level1type = N'Table', @level1name = [myTable], @level2type = N'Column', @level2name = [varchar];` });
    });

    it('createTableQuery with comments and table object', function () {
      expectsql(this.queryGenerator.createTableQuery({ tableName: 'myTable' }, { int: 'INTEGER COMMENT Foo Bar', varchar: 'VARCHAR(50) UNIQUE COMMENT Bar Foo' }, {}), { mssql: `IF OBJECT_ID(N'[myTable]', 'U') IS NULL CREATE TABLE [myTable] ([int] INTEGER, [varchar] VARCHAR(50) UNIQUE); EXEC sp_addextendedproperty @name = N'MS_Description', @value = N'Foo Bar', @level0type = N'Schema', @level0name = 'dbo', @level1type = N'Table', @level1name = [myTable], @level2type = N'Column', @level2name = [int]; EXEC sp_addextendedproperty @name = N'MS_Description', @value = N'Bar Foo', @level0type = N'Schema', @level0name = 'dbo', @level1type = N'Table', @level1name = [myTable], @level2type = N'Column', @level2name = [varchar];` });
    });

    it('getDefaultConstraintQuery', function () {
      expectsql(this.queryGenerator.getDefaultConstraintQuery({ tableName: 'myTable', schema: 'mySchema' }, 'myColumn'), {
        mssql: `SELECT name FROM sys.default_constraints WHERE PARENT_OBJECT_ID = OBJECT_ID('[mySchema].[myTable]', 'U') AND PARENT_COLUMN_ID = (SELECT column_id FROM sys.columns WHERE NAME = ('myColumn') AND object_id = OBJECT_ID('[mySchema].[myTable]', 'U'));`,
      });
    });

    it('dropConstraintQuery', function () {
      expectsql(this.queryGenerator.dropConstraintQuery({ tableName: 'myTable', schema: 'mySchema' }, 'myConstraint'), {
        mssql: 'ALTER TABLE [mySchema].[myTable] DROP CONSTRAINT [myConstraint];',
      });
    });

    it('bulkInsertQuery', function () {
      // normal cases
      expectsql(this.queryGenerator.bulkInsertQuery('myTable', [{ name: 'foo' }, { name: 'bar' }]), {
        mssql: 'INSERT INTO [myTable] ([name]) VALUES (N\'foo\'),(N\'bar\');',
      });

      expectsql(this.queryGenerator.bulkInsertQuery('myTable', [{ username: 'username', firstName: 'firstName', lastName: 'lastName' }, { firstName: 'user1FirstName', lastName: 'user1LastName' }]), {
        mssql: 'INSERT INTO [myTable] ([username],[firstName],[lastName]) VALUES (N\'username\',N\'firstName\',N\'lastName\'),(NULL,N\'user1FirstName\',N\'user1LastName\');',
      });

      expectsql(this.queryGenerator.bulkInsertQuery('myTable', [{ firstName: 'firstName', lastName: 'lastName' }, { firstName: 'user1FirstName', lastName: 'user1LastName' }]), {
        mssql: 'INSERT INTO [myTable] ([firstName],[lastName]) VALUES (N\'firstName\',N\'lastName\'),(N\'user1FirstName\',N\'user1LastName\');',
      });

      // Bulk Insert With autogenerated primary key
      const attributes = { id: { autoIncrement: true } };
      expectsql(this.queryGenerator.bulkInsertQuery('myTable', [{ id: null }], {}, attributes), {
        mssql: 'INSERT INTO [myTable] DEFAULT VALUES;',
      });
    });

    it('selectFromTableFragment', function () {
      // Base case
      expectsql(this.queryGenerator.selectFromTableFragment({}, { primaryKeyField: 'id' }, ['id', 'name'], 'myTable', 'myOtherName', 'WHERE id=1'), {
        mssql: 'SELECT id, name FROM myTable AS myOtherName',
      });

      // With tableHint - nolock
      expectsql(this.queryGenerator.selectFromTableFragment({ tableHint: TableHints.NOLOCK }, { primaryKeyField: 'id' }, ['id', 'name'], 'myTable', 'myOtherName'), {
        mssql: 'SELECT id, name FROM myTable AS myOtherName WITH (NOLOCK)',
      });

      // With tableHint - NOWAIT
      expectsql(this.queryGenerator.selectFromTableFragment({ tableHint: TableHints.NOWAIT }, { primaryKeyField: 'id' }, ['id', 'name'], 'myTable', 'myOtherName'), {
        mssql: 'SELECT id, name FROM myTable AS myOtherName WITH (NOWAIT)',
      });

      // With limit
      expectsql(this.queryGenerator.selectFromTableFragment({ limit: 10 }, { primaryKeyField: 'id' }, ['id', 'name'], 'myTable', 'myOtherName'), {
        mssql: 'SELECT id, name FROM myTable AS myOtherName',
      });

      // With offset
      expectsql(this.queryGenerator.selectFromTableFragment({ offset: 10 }, { primaryKeyField: 'id' }, ['id', 'name'], 'myTable', 'myOtherName'), {
        mssql: 'SELECT id, name FROM myTable AS myOtherName',
      });

      // With both limit and offset
      expectsql(this.queryGenerator.selectFromTableFragment({ limit: 10, offset: 10 }, { primaryKeyField: 'id' }, ['id', 'name'], 'myTable', 'myOtherName'), {
        mssql: 'SELECT id, name FROM myTable AS myOtherName',
      });
    });

    it('getPrimaryKeyConstraintQuery', function () {
      expectsql(this.queryGenerator.getPrimaryKeyConstraintQuery('myTable', 'myColumnName'), {
        mssql: 'SELECT K.TABLE_NAME AS tableName, K.COLUMN_NAME AS columnName, K.CONSTRAINT_NAME AS constraintName FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS AS C JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS K ON C.TABLE_NAME = K.TABLE_NAME AND C.CONSTRAINT_CATALOG = K.CONSTRAINT_CATALOG AND C.CONSTRAINT_SCHEMA = K.CONSTRAINT_SCHEMA AND C.CONSTRAINT_NAME = K.CONSTRAINT_NAME WHERE C.CONSTRAINT_TYPE = \'PRIMARY KEY\' AND K.COLUMN_NAME = \'myColumnName\' AND K.TABLE_NAME = \'myTable\';',
      });
    });

    it('versionQuery', function () {
      expectsql(this.queryGenerator.versionQuery(), {
        mssql: 'DECLARE @ms_ver NVARCHAR(20); SET @ms_ver = REVERSE(CONVERT(NVARCHAR(20), SERVERPROPERTY(\'ProductVersion\'))); SELECT REVERSE(SUBSTRING(@ms_ver, CHARINDEX(\'.\', @ms_ver)+1, 20)) AS \'version\'',
      });
    });

    it('renameTableQuery', function () {
      expectsql(this.queryGenerator.renameTableQuery('oldTableName', 'newTableName'), {
        mssql: 'EXEC sp_rename [oldTableName], [newTableName];',
      });
    });

    it('showTablesQuery', function () {
      expectsql(this.queryGenerator.showTablesQuery(), {
        mssql: 'SELECT TABLE_NAME, TABLE_SCHEMA FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = \'BASE TABLE\';',
      });
    });

    it('addColumnQuery', function () {
      expectsql(this.queryGenerator.addColumnQuery('myTable', 'myColumn', { type: 'VARCHAR(255)' }), {
        mssql: 'ALTER TABLE [myTable] ADD [myColumn] VARCHAR(255) NULL;',
      });
    });

    it('addColumnQuery with comment', function () {
      expectsql(this.queryGenerator.addColumnQuery('myTable', 'myColumn', { type: 'VARCHAR(255)', comment: 'This is a comment' }), {
        mssql: 'ALTER TABLE [myTable] ADD [myColumn] VARCHAR(255) NULL; EXEC sp_addextendedproperty '
          + '@name = N\'MS_Description\', @value = N\'This is a comment\', '
          + '@level0type = N\'Schema\', @level0name = \'dbo\', '
          + '@level1type = N\'Table\', @level1name = [myTable], '
          + '@level2type = N\'Column\', @level2name = [myColumn];',
      });
    });

    it('removeColumnQuery', function () {
      expectsql(this.queryGenerator.removeColumnQuery('myTable', 'myColumn'), {
        mssql: 'ALTER TABLE [myTable] DROP COLUMN [myColumn];',
      });
    });

    it('getForeignKeyQuery', function () {
      expectsql(this.queryGenerator.getForeignKeyQuery('myTable', 'myColumn'), {
        mssql: 'SELECT constraint_name = OBJ.NAME, constraintName = OBJ.NAME, constraintSchema = SCHEMA_NAME(OBJ.SCHEMA_ID), tableName = TB.NAME, tableSchema = SCHEMA_NAME(TB.SCHEMA_ID), columnName = COL.NAME, referencedTableSchema = SCHEMA_NAME(RTB.SCHEMA_ID), referencedTableName = RTB.NAME, referencedColumnName = RCOL.NAME FROM sys.foreign_key_columns FKC INNER JOIN sys.objects OBJ ON OBJ.OBJECT_ID = FKC.CONSTRAINT_OBJECT_ID INNER JOIN sys.tables TB ON TB.OBJECT_ID = FKC.PARENT_OBJECT_ID INNER JOIN sys.columns COL ON COL.COLUMN_ID = PARENT_COLUMN_ID AND COL.OBJECT_ID = TB.OBJECT_ID INNER JOIN sys.tables RTB ON RTB.OBJECT_ID = FKC.REFERENCED_OBJECT_ID INNER JOIN sys.columns RCOL ON RCOL.COLUMN_ID = REFERENCED_COLUMN_ID AND RCOL.OBJECT_ID = RTB.OBJECT_ID WHERE TB.NAME =\'myTable\' AND COL.NAME =\'myColumn\'',
      });
      expectsql(this.queryGenerator.getForeignKeyQuery({
        tableName: 'myTable',
        schema: 'mySchema',
      }, 'myColumn'), {
        mssql: 'SELECT constraint_name = OBJ.NAME, constraintName = OBJ.NAME, constraintSchema = SCHEMA_NAME(OBJ.SCHEMA_ID), tableName = TB.NAME, tableSchema = SCHEMA_NAME(TB.SCHEMA_ID), columnName = COL.NAME, referencedTableSchema = SCHEMA_NAME(RTB.SCHEMA_ID), referencedTableName = RTB.NAME, referencedColumnName = RCOL.NAME FROM sys.foreign_key_columns FKC INNER JOIN sys.objects OBJ ON OBJ.OBJECT_ID = FKC.CONSTRAINT_OBJECT_ID INNER JOIN sys.tables TB ON TB.OBJECT_ID = FKC.PARENT_OBJECT_ID INNER JOIN sys.columns COL ON COL.COLUMN_ID = PARENT_COLUMN_ID AND COL.OBJECT_ID = TB.OBJECT_ID INNER JOIN sys.tables RTB ON RTB.OBJECT_ID = FKC.REFERENCED_OBJECT_ID INNER JOIN sys.columns RCOL ON RCOL.COLUMN_ID = REFERENCED_COLUMN_ID AND RCOL.OBJECT_ID = RTB.OBJECT_ID WHERE TB.NAME =\'myTable\' AND COL.NAME =\'myColumn\' AND SCHEMA_NAME(TB.SCHEMA_ID) =\'mySchema\'',
      });
    });

    it('dropForeignKeyQuery', function () {
      expectsql(this.queryGenerator.dropForeignKeyQuery('myTable', 'myColumnKey'), {
        mssql: 'ALTER TABLE [myTable] DROP [myColumnKey]',
      });
    });
  });
}
